const { createClient } = require('@supabase/supabase-js');
exports.handler=async(event)=>{
 if(event.httpMethod!=='POST')return {statusCode:405,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify({error:'Method not allowed'})};
 try{
  const token=(event.headers.authorization||'').replace('Bearer ','');
  if(!token)return {statusCode:401,body:JSON.stringify({error:'Login required'})};
  const supabase=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
  const {data:{user},error:ue}=await supabase.auth.getUser(token);
  if(ue||!user)return {statusCode:401,body:JSON.stringify({error:'Invalid session'})};
  const {productId}=JSON.parse(event.body||'{}');
  if(!productId)return {statusCode:400,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify({error:'Product id required'})};
  const {data:purchase,error:purchaseError}=await supabase.from('purchases').select('id').eq('user_id',user.id).eq('product_id',productId).maybeSingle();
  if(purchaseError)return {statusCode:500,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify({error:'Could not verify purchase'})};
  if(!purchase)return {statusCode:403,body:JSON.stringify({error:'This product is not owned by your account'})};
  const {data:file,error:fileError}=await supabase.from('product_files').select('storage_path').eq('product_id',productId).eq('is_current',true).order('created_at',{ascending:false}).limit(1).maybeSingle();
  if(fileError)return {statusCode:500,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify({error:'Could not load product file'})};
  if(!file)return {statusCode:404,body:JSON.stringify({error:'Product file is not available yet'})};
  const {data:signed,error:se}=await supabase.storage.from('paid-products').createSignedUrl(file.storage_path,120);
  if(se||!signed)return {statusCode:500,body:JSON.stringify({error:'Could not create secure download'})};
  const {error:logError}=await supabase.from('download_events').insert({user_id:user.id,product_id:productId});
  if(logError)console.error('download event log failed',logError.message);
  return {statusCode:200,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify({url:signed.signedUrl})};
 }catch(e){return {statusCode:500,body:JSON.stringify({error:'Secure download error'})}}
};