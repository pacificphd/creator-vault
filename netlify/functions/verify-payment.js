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
  if(!order||!payment||payment.order_id!==order.id||!['authorized','captured'].includes(payment.status))return out(400,{error:'Payment is not completed'});
  const notes=order.notes||{};if(String(notes.user_id||'')!==user.id)return out(403,{error:'Payment does not belong to this account'});
  const ids=String(notes.product_ids||'').split(',').map(x=>x.trim()).filter(Boolean);if(!ids.length)return out(400,{error:'Order has no products'});
  const {data:products,error:pe0}=await supabase.from('products').select('id').in('id',ids);if(pe0||!products||products.length!==ids.length)return out(400,{error:'Order products could not be verified'});
  const {data:owned,error:oe}=await supabase.from('purchases').select('product_id').eq('user_id',user.id).in('product_id',ids);if(oe)return out(500,{error:'Could not verify existing purchases'});
  const have=new Set((owned||[]).map(x=>String(x.product_id))),missing=ids.filter(id=>!have.has(String(id)));
  if(missing.length){const rows=missing.map(product_id=>({user_id:user.id,product_id}));const {error:pe}=await supabase.from('purchases').insert(rows);if(pe)return out(500,{error:'Payment verified but purchase access could not be granted'})}
  return out(200,{ok:true,paymentId:b.razorpay_payment_id,granted:ids.length});
 }catch(e){return out(500,{error:'Payment verification failed'})}
};