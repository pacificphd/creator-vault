const { createClient }=require('@supabase/supabase-js');
const out=(statusCode,body)=>({statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(body)});
exports.handler=async(event)=>{
 if(event.httpMethod!=='POST')return out(405,{error:'Method not allowed'});
 try{
  const code=String(JSON.parse(event.body||'{}').code||'').trim().toUpperCase();
  if(!code)return out(400,{error:'Coupon code required'});
  const supabase=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
  const {data,error}=await supabase.from('coupons').select('code,discount_type,value,active,expires_at').eq('code',code).maybeSingle();
  if(error)return out(400,{error:'Coupon service is not ready'});
  if(!data||!data.active)return out(404,{error:'Invalid or inactive coupon'});\n  if(data.expires_at&&new Date(data.expires_at).getTime()<=Date.now())return out(404,{error:'Coupon has expired'});
  return out(200,{coupon:{code:data.code,discount_type:data.discount_type,value:Number(data.value)}});
 }catch(e){return out(400,{error:'Invalid coupon request'})}
};