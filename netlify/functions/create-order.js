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
  const body=JSON.parse(event.body||'{}'),ids=[...new Set((body.productIds||[]).map(String))];if(!ids.length)return out(400,{error:'Cart is empty'});
  const {data:products,error:pe}=await supabase.from('products').select('id,name,price,active').in('id',ids);if(pe)return out(400,{error:'Unable to load products'});
  if(!products||products.length!==ids.length||products.some(p=>!p.active))return out(400,{error:'One or more products are unavailable'});
  const subtotal=products.reduce((a,p)=>a+Number(p.price||0),0);let discount=0,coupon=null;
  if(body.coupon){
   const code=String(body.coupon).trim().toUpperCase();const {data:c}=await supabase.from('coupons').select('code,discount_type,value,active').eq('code',code).maybeSingle();
   if(!c||!c.active)return out(400,{error:'Invalid or inactive coupon'});coupon=c.code;discount=c.discount_type==='fixed'?Number(c.value):subtotal*(Number(c.value)/100);discount=Math.min(subtotal,Math.max(0,discount));
  }
  const total=Math.round((subtotal-discount)*100);if(total<100)return out(400,{error:'Order total is too low for online payment'});
  const rz=new Razorpay({key_id:process.env.RAZORPAY_KEY_ID,key_secret:process.env.RAZORPAY_KEY_SECRET});
  const order=await rz.orders.create({amount:total,currency:'INR',receipt:'cv_'+Date.now(),notes:{user_id:user.id,product_ids:ids.join(','),coupon:coupon||''}});
  return out(200,{orderId:order.id,amount:order.amount,currency:order.currency,keyId:process.env.RAZORPAY_KEY_ID,subtotal,discount,total:subtotal-discount});
 }catch(e){return out(500,{error:'Unable to create payment order'})}
};