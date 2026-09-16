import crypto from 'node:crypto';
import http from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { BrowserAgent } from '../scripts/browser-agent.mjs';

const port=Number(process.env.PORT||3000), host=process.env.HOST||'0.0.0.0', bearerToken=process.env.BROWSER_CONNECTOR_TOKEN||'';
const sessions=new Map();
function result(value){return {content:[{type:'text',text:JSON.stringify(value,null,2)}],structuredContent:value};}
function fail(error){return {isError:true,content:[{type:'text',text:String(error?.stack||error)}]};}
function authorized(req){return !bearerToken||req.headers.authorization===`Bearer ${bearerToken}`;}
function json(res,status,value){res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));}
async function readJson(req){const chunks=[];for await(const chunk of req)chunks.push(chunk);const text=Buffer.concat(chunks).toString('utf8');return text?JSON.parse(text):undefined;}
function buildServer(agent){
 const server=new McpServer({name:'browser-connector-poc-http',version:'0.1.0'});
 server.tool('browser_start','Start and retain one browser session. Optionally navigate to a URL.',{url:z.string().optional()},async({url})=>{try{return result(await agent.start(url));}catch(e){return fail(e);}});
 server.tool('browser_get_page','Observe current page and return fresh short-lived elementIds.',{},async()=>{try{return result(await agent.getPage());}catch(e){return fail(e);}});
 server.tool('browser_goto','Navigate retained browser to a URL and return a fresh observation.',{url:z.string().url()},async({url})=>{try{return result(await agent.goto(url));}catch(e){return fail(e);}});
 server.tool('browser_fill','Fill an editable element from the latest observation.',{elementId:z.string(),text:z.string()},async({elementId,text})=>{try{return result(await agent.fill(elementId,text));}catch(e){return fail(e);}});
 server.tool('browser_click','Click an element from the latest observation.',{elementId:z.string()},async({elementId})=>{try{return result(await agent.click(elementId));}catch(e){return fail(e);}});
 server.tool('browser_press','Press a keyboard key.',{key:z.string()},async({key})=>{try{return result(await agent.press(key));}catch(e){return fail(e);}});
 server.tool('browser_scroll','Scroll current page.',{direction:z.enum(['up','down']).default('down'),amount:z.number().int().positive().max(5000).default(700)},async({direction,amount})=>{try{return result(await agent.scroll(direction,amount));}catch(e){return fail(e);}});
 server.tool('browser_end','Close retained browser session.',{},async()=>{try{return result(await agent.end());}catch(e){return fail(e);}});
 return server;
}
const app=http.createServer(async(req,res)=>{try{const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);if(url.pathname==='/healthz')return json(res,200,{ok:true,sessions:sessions.size});if(url.pathname!=='/mcp')return json(res,404,{error:'not_found'});if(!authorized(req))return json(res,401,{error:'unauthorized'});const sessionId=req.headers['mcp-session-id'];if(req.method==='POST'){const body=await readJson(req);let record=sessionId?sessions.get(String(sessionId)):undefined;if(!record){if(!isInitializeRequest(body))return json(res,400,{error:'initialize_required'});const agent=new BrowserAgent({headless:process.env.BROWSER_HEADLESS!=='false'}),server=buildServer(agent),transport=new StreamableHTTPServerTransport({sessionIdGenerator:()=>crypto.randomUUID(),onsessioninitialized:id=>sessions.set(id,{server,transport,agent})});transport.onclose=async()=>{for(const[id,value]of sessions)if(value.transport===transport)sessions.delete(id);await agent.end().catch(()=>{});};await server.connect(transport);record={server,transport,agent};}return await record.transport.handleRequest(req,res,body);}const record=sessionId?sessions.get(String(sessionId)):undefined;if(!record)return json(res,400,{error:'invalid_or_missing_session'});if(req.method==='GET'||req.method==='DELETE')return await record.transport.handleRequest(req,res);return json(res,405,{error:'method_not_allowed'});}catch(error){if(!res.headersSent)json(res,500,{error:String(error?.message||error)});else res.end();}});
async function shutdown(){for(const{agent,transport}of sessions.values()){await agent.end().catch(()=>{});await transport.close().catch(()=>{});}app.close(()=>process.exit(0));}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);app.listen(port,host,()=>console.log(`BROWSER_CONNECTOR_HTTP_READY http://${host}:${port}/mcp`));
