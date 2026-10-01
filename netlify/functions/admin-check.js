const { createClient } = require('@supabase/supabase-js');
const json=(statusCode,body)=>({statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(body)});
exports.handler=async(event)=>{
 if(event.httpMethod!=='GET')return json(405,{error:'Method not allowed'});
 try{
  const token=(event.headers.authorization||'').replace('Bearer ','');
  if(!token)return json(401,{error:'Login required'});
  const supabase=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
  const {data:{user},error}=await supabase.auth.getUser(token);
  if(error||!user)return json(401,{error:'Invalid session'});
  const adminEmails=(process.env.ADMIN_EMAILS||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
  if(!adminEmails.includes((user.email||'').toLowerCase()))return json(403,{error:'Admin access required'});
  return json(200,{admin:true,email:user.email});
 }catch(e){return json(500,{error:'Admin check failed'})}
};