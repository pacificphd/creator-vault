const crypto=require('crypto');
const Razorpay=require('razorpay');
const {createClient}=require('@supabase/supabase-js');
const out=(s,b)=>({statusCode:s,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(b)});
exports.handler=async event=>{
 if(event.httpMethod!=='POST')return out(405,{error:'Method not allowed'});
 try{
  if(!process.env.RAZORPAY_KEY_ID||!process.env.RAZORPAY_KEY_SECRET)return out(503,{error:'Payments are not activated yet'});
  const token=(event.headers.authorization||'').replace('Bearer ','');
  const supabase=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
  const {data:{user},error:ue}=await supabase.auth.getUser(token);if(ue||!user)return out(401,{error:'Login required'});
  const b=JSON.parse(event.body||'{}');
  if(!b.razorpay_order_id||!b.razorpay_payment_id||!b.razorpay_signature)return out(400,{error:'Incomplete payment response'});
  const expected=crypto.createHmac('sha256',process.env.RAZORPAY_KEY_SECRET).update(b.razorpay_order_id+'|'+b.razorpay_payment_id).digest('hex');
  const a=Buffer.from(expected),z=Buffer.from(String(b.razorpay_signature));if(a.length!==z.length||!crypto.timingSafeEqual(a,z))return out(400,{error:'Payment verification failed'});
  const rz=new Razorpay({key_id:process.env.RAZORPAY_KEY_ID,key_secret:process.env.RAZORPAY_KEY_SECRET});
  const [order,payment]=await Promise.all([rz.orders.fetch(b.razorpay_order_id),rz.payments.fetch(b.razorpay_payment_id)]);
  if(!order||!payment||payment.order_id!==order.id||payment.status!=='captured')return out(400,{error:'Payment is not completed'});
  if(String(order.status||'')!=='paid')return out(400,{error:'Order is not marked paid'});
  if(Number(payment.amount)!==Number(order.amount)||String(payment.currency||'')!==String(order.currency||''))return out(400,{error:'Payment amount verification failed'});
  const notes=order.notes||{};if(String(notes.user_id||'')!==user.id)return out(403,{error:'Payment does not belong to this account'});
  if(String(order.currency||'')!=='INR')return out(400,{error:'Unexpected payment currency'});
  const ids=String(notes.product_ids||'').split(',').map(x=>x.trim()).filter(Boolean);if(!ids.length)return out(400,{error:'Order has no products'});
  const {data:products,error:pe0}=await supabase.from('products').select('id,name,price,category_id,slug,thumbnail_path').in('id',ids);if(pe0||!products||products.length!==ids.length)return out(400,{error:'Order products could not be verified'});
  const {data:owned,error:oe}=await supabase.from('purchases').select('product_id').eq('user_id',user.id).in('product_id',ids);if(oe)return out(500,{error:'Could not verify existing purchases'});
  const have=new Set((owned||[]).map(x=>String(x.product_id))),missing=ids.filter(id=>!have.has(String(id)));
  let savedOrderId=null;
  const {data:orderRow,error:orderSaveError}=await supabase.from('orders').upsert({user_id:user.id,email:user.email||'',amount:Number(order.amount),status:'paid',payment_provider:'razorpay',provider_order_id:order.id,provider_payment_id:payment.id},{onConflict:'provider_order_id'}).select('id').single();
  if(orderSaveError)return out(500,{error:'Payment verified but order record could not be saved'});savedOrderId=orderRow.id;
  const unitPrices=new Map((products||[]).map(p=>[String(p.id),Number(p.price||0)]));
  const subtotalNote=Number(notes.subtotal||0),discountNote=Number(notes.discount||0),factor=subtotalNote>0?Math.max(0,(subtotalNote-discountNote)/subtotalNote):1;
  const itemRows=ids.map(product_id=>({order_id:savedOrderId,product_id,price:Math.round((unitPrices.get(String(product_id))||0)*factor*100)}));
  const {error:itemError}=await supabase.from('order_items').upsert(itemRows,{onConflict:'order_id,product_id'});if(itemError)return out(500,{error:'Payment verified but order items could not be saved'});
  if(missing.length){const rows=missing.map(product_id=>({user_id:user.id,product_id,order_id:savedOrderId}));const {error:pe}=await supabase.from('purchases').upsert(rows,{onConflict:'user_id,product_id',ignoreDuplicates:true});if(pe)return out(500,{error:'Payment verified but purchase access could not be granted'})}
  let emailSent=false;
  try{
   if(process.env.RESEND_API_KEY&&user.email){
    const names=(products||[]).map(p=>p.name).join(', ');
    const boughtCats=new Set((products||[]).map(p=>String(p.category_id||'')));
    const {data:allOwned}=await supabase.from('purchases').select('product_id').eq('user_id',user.id),ownedIds=new Set((allOwned||[]).map(x=>String(x.product_id)));
    const {data:others}=await supabase.from('products').select('id,name,price,category_id,slug,thumbnail_path').eq('active',true).limit(30);
    const recs=(others||[]).filter(p=>!ownedIds.has(String(p.id))).sort((x,y)=>(boughtCats.has(String(y.category_id))?1:0)-(boughtCats.has(String(x.category_id))?1:0)).slice(0,3);
    const site=String(process.env.URL||'').replace(/\/$/,'');
    const escHtml=s=>String(s||'').replace(/[&<>"]/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[x]));
    const assetUrl=p=>{const x=String(p.thumbnail_path||'');if(!x)return '';if(/^https?:\/\//i.test(x))return x;const base=String(process.env.SUPABASE_URL||'').replace(/\/$/,'');return base?base+'/storage/v1/object/public/site-assets/'+x.replace(/^\/+/, ''):''};
    const recHtml=recs.length?'<div style="margin-top:28px"><h3 style="margin-bottom:8px">You may also like</h3>'+recs.map(p=>{const link=site+'/?product='+encodeURIComponent(p.id),img=assetUrl(p);return '<div style="border-top:1px solid #eadfcd;padding:14px 0;display:flex;gap:12px;align-items:center">'+(img?'<img src="'+escHtml(img)+'" width="72" height="72" style="object-fit:cover;border-radius:10px" alt="">':'')+'<div style="flex:1"><b>'+escHtml(p.name)+'</b><div style="margin-top:5px">₹'+Number(p.price||0).toLocaleString('en-IN')+'</div></div>'+(site?'<a href="'+link+'" style="color:#8a641f;text-decoration:none;font-weight:bold">View Product</a>':'')+'</div>'}).join('')+'</div>':'';
    const total=(Number(order.amount||0)/100).toLocaleString('en-IN',{style:'currency',currency:'INR'});
    const logo=site?site+'/assets/creator-vault-logo.webp':'';
    const downloadsUrl=site?site+'/?open=downloads':'';
    const html='<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#171714;background:#faf7f0;padding:28px;border-radius:18px">'+(logo?'<div style="text-align:center;margin-bottom:24px"><img src="'+logo+'" alt="Creator Vault" width="240" style="display:inline-block;max-width:80%;height:auto"></div>':'')+'<h2 style="margin:0 0 14px">Payment successful</h2><p>Thank you for your Creator Vault purchase.</p><p><b>Products:</b> '+names.replace(/[&<>"]/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[x]))+'<br><b>Amount:</b> '+total+'<br><b>Payment ID:</b> '+String(b.razorpay_payment_id).replace(/[&<>"]/g,'')+'</p><p>Your purchased products are securely linked to this account.</p>'+(downloadsUrl?'<p><a href="'+downloadsUrl+'" style="display:inline-block;padding:13px 20px;background:#171714;color:white;text-decoration:none;border-radius:999px;font-weight:bold">Download Your Products</a></p>':'')+'<p style="color:#70695f;font-size:13px">For security, sign in with the same email/account used for your purchase. The button opens your purchased library; the original Google Drive link is not exposed in this email.</p>'+recHtml+'<p style="color:#70695f;font-size:12px">Keep this email for your payment reference.</p></div>';
    const er=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({from:process.env.ORDER_EMAIL_FROM||'Creator Vault <onboarding@resend.dev>',to:[user.email],subject:'Creator Vault — Payment successful',html})});
    emailSent=er.ok;
   }
  }catch(e){}
  return out(200,{ok:true,paymentId:b.razorpay_payment_id,granted:ids.length,emailSent});
 }catch(e){return out(500,{error:'Payment verification failed'})}
};