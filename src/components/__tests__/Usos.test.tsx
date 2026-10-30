// @vitest-environment jsdom
import React,{act,StrictMode} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {MemoryRouter,Routes,Route} from 'react-router-dom';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import Login from '../../pages/Login';
import UsosReturn from '../../pages/UsosReturn';
import UsosAccountControls from '../UsosAccountControls';
import {finishUsosAuth} from '../../lib/usosAuth';
import {setUiLanguage} from '../../i18n';
const mock=vi.hoisted(()=>({ctx:{} as any}));
vi.mock('../../context/ZenosContext',()=>({useZenos:()=>mock.ctx}));
vi.mock('../../lib/supabase',()=>({SUPABASE_CONFIGURED:true,supabase:{auth:{verifyOtp:vi.fn()}}}));
let root:Root,host:HTMLDivElement;
const button=(text:string)=>[...document.querySelectorAll('button')].find(el=>el.textContent?.includes(text))!;
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;setUiLanguage('en');mock.ctx={user:null,isOffline:false,usosEnabled:false,usosConnected:false,usosError:'',loginWithGoogle:vi.fn(),loginOffline:vi.fn(),loginWithUsos:vi.fn(),connectUsos:vi.fn(),disconnectUsos:vi.fn()};host=document.createElement('div');document.body.append(host);root=createRoot(host);window.history.replaceState(null,'','/');});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();window.history.replaceState(null,'','/');setUiLanguage('en');vi.restoreAllMocks();});
it('hides university sign-in until enabled, shows it below Google and supports Polish',async()=>{await act(async()=>root.render(<MemoryRouter><Login/></MemoryRouter>));expect(host.textContent).not.toContain('Log in with USOS');mock.ctx.usosEnabled=true;await act(async()=>root.render(<MemoryRouter><Login/></MemoryRouter>));expect(host.textContent!.indexOf('Log in with USOS')).toBeGreaterThan(host.textContent!.indexOf('Continue with Google'));await act(async()=>button('Log in with USOS').click());expect(mock.ctx.loginWithUsos).toHaveBeenCalledOnce();await act(async()=>setUiLanguage('pl'));expect(host.textContent).toContain('Zaloguj się przez USOS');});
it('shows only a friendly whitelisted error on the login screen',async()=>{await act(async()=>root.render(<MemoryRouter initialEntries={['/?usos_error=link_required']}><Login/></MemoryRouter>));expect(host.querySelector('[role=alert]')?.textContent).toContain('existing method');expect(host.textContent).not.toContain('consumer');});
it('clears fragment credentials before a deduplicated StrictMode handoff, verifies OTP, then navigates home',async()=>{
 const hash='a'.repeat(64),state='x'.repeat(43);window.history.replaceState(null,'','/auth/usos#'+new URLSearchParams({token_hash:hash,type:'magiclink',state}));const verifyOtp=vi.fn(async()=>({data:{session:{access_token:'signed'}},error:null}));const request=vi.fn(async()=>{expect(window.location.hash).toBe('');return new Response('{"ok":true}');});mock.ctx.finishUsosLogin=(fragment:string)=>finishUsosAuth(fragment,{configured:true,client:{auth:{verifyOtp}} as any,request:request as any});
 await act(async()=>root.render(<StrictMode><MemoryRouter initialEntries={['/auth/usos']}><Routes><Route path="auth/usos" element={<UsosReturn/>}/><Route path="/" element={<h1>Home after sign-in</h1>}/></Routes></MemoryRouter></StrictMode>));expect(request).toHaveBeenCalledOnce();expect(verifyOtp).toHaveBeenCalledOnce();expect(window.location.hash).toBe('');expect(host.textContent).toContain('Home after sign-in');
});
it('requires explicit confirmation before disconnect and never shows account actions in local mode',async()=>{mock.ctx.usosEnabled=true;mock.ctx.usosConnected=true;await act(async()=>root.render(<UsosAccountControls/>));await act(async()=>button('Disconnect USOS').click());expect(mock.ctx.disconnectUsos).not.toHaveBeenCalled();const dialog=document.querySelector('[role=dialog]')!;expect(dialog.textContent).toContain('another way to sign in');await act(async()=>[...dialog.querySelectorAll('button')].find(el=>el.textContent==='Disconnect USOS')!.click());expect(mock.ctx.disconnectUsos).toHaveBeenCalledOnce();mock.ctx.isOffline=true;await act(async()=>root.render(<UsosAccountControls/>));expect(host.textContent).toBe('');});
