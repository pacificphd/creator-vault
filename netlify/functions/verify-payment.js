const crypto=require('crypto');
const {createClient}=require('@supabase/supabase-js');
const out=(s,b)=>({statusCode:s,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(b)});
exports.handler=async event=>{
 if(event.httpMethod!=='POST')return out(405,{error:'Method not allowed'});
 try{
  if(!process.env.RAZORPAY_KEY_SECRET)return out(503,{error:'Payments are not activated yet'});
  const token=(event.headers.authorization||'').replace('Bearer ','');
  const supabase=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
  const {data:{user},error:ue}=await supabase.auth.getUser(token);if(ue||!user)return out(401,{error:'Login required'});
  const b=JSON.parse(event.body||'{}');
  if(!b.razorpay_order_id||!b.razorpay_payment_id||!b.razorpay_signature)return out(400,{error:'Incomplete payment response'});
  const expected=crypto.createHmac('sha256',process.env.RAZORPAY_KEY_SECRET).update(b.razorpay_order_id+'|'+b.razorpay_payment_id).digest('hex');
  const a=Buffer.from(expected),z=Buffer.from(String(b.razorpay_signature));if(a.length!==z.length||!crypto.timingSafeEqual(a,z))return out(400,{error:'Payment verification failed'});
  const ids=[...new Set((b.productIds||[]).map(String))];if(!ids.length)return out(400,{error:'Missing purchased products'});
  const rows=ids.map(product_id=>({user_id:user.id,product_id}));
  const {error:pe}=await supabase.from('purchases').upsert(rows,{onConflict:'user_id,product_id'});if(pe)return out(500,{error:'Payment verified but purchase access could not be granted'});
  return out(200,{ok:true,paymentId:b.razorpay_payment_id,granted:ids.length});
 }catch(e){return out(500,{error:'Payment verification failed'})}
};