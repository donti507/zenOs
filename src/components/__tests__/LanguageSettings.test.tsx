// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {setUiLanguage} from '../../i18n';
import LanguageSwitcher from '../LanguageSwitcher';
import Login from '../../pages/Login';
import Tasks from '../../pages/Tasks';
import Modals from '../Modals';
const mock=vi.hoisted(()=>({ctx:{} as any,signIn:vi.fn()}));
vi.mock('../../context/ZenosContext',()=>({useZenos:()=>mock.ctx}));
vi.mock('../../lib/supabase',()=>({SUPABASE_CONFIGURED:true,supabase:{auth:{signInWithPassword:mock.signIn}}}));
let host:HTMLDivElement,root:Root;
const input=(el:HTMLInputElement,value:string)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));};
const button=(label:string)=>[...host.querySelectorAll('button')].find(el=>el.textContent===label||el.getAttribute('aria-label')===label)!;
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;localStorage.clear();setUiLanguage('en');mock.signIn.mockReset();mock.ctx={state:{theme:'light',tasks:[{id:'t',title:'Home',note:'Calendar',cat:'c',status:'todo',date:'',steps:[],reminder:'',progress:0}],categories:[{id:'c',label:'Meetings',color:'#888'}],meetings:[],vault:[],completionLog:[],filterCat:null},showModal:null,googleConnected:false,loginWithGoogle:vi.fn(),loginOffline:vi.fn(),updateState:vi.fn(),toggleTaskDone:vi.fn(),setShowModal:vi.fn(),setEditTaskId:vi.fn(),addTask:vi.fn(async value=>({...value,id:'new'}))};host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();setUiLanguage('en');vi.restoreAllMocks();});
it('switches the login form live while retaining unsaved email and showing Polish validation without auth calls',async()=>{
 await act(async()=>root.render(<MemoryRouter><Login/></MemoryRouter>));const email=host.querySelector<HTMLInputElement>('input[type=email]')!;await act(async()=>input(email,'anna@example.com'));await act(async()=>button('Polski').click());expect(host.querySelector('h1')?.textContent).toBe('Witaj ponownie');expect(host.querySelector('input[type=email]')).toBe(email);expect(email.value).toBe('anna@example.com');await act(async()=>button('Zaloguj się').click());expect(host.querySelector('[role=alert]')?.textContent).toContain('Wpisz adres e-mail i hasło.');expect(mock.signIn).not.toHaveBeenCalled();await act(async()=>button('English').click());expect(host.querySelector('h1')?.textContent).toBe('Welcome back');expect(email.value).toBe('anna@example.com');expect(host.querySelector('[role=alert]')?.textContent).toContain('Enter your email and password.');
});
it('translates task controls but keeps user titles, notes, category names and status IDs intact',async()=>{
 const original=JSON.stringify(mock.ctx.state);await act(async()=>root.render(<MemoryRouter><LanguageSwitcher/><Tasks/></MemoryRouter>));await act(async()=>button('Polski').click());expect(host.querySelector('h1')?.textContent).toBe('Wszystkie zadania');expect(host.textContent).toContain('Home');expect(host.textContent).toContain('Calendar');expect(host.textContent).toContain('Meetings');expect(host.querySelector('[aria-label="Ukończ „Home”"]')).not.toBeNull();expect(JSON.stringify(mock.ctx.state)).toBe(original);expect(mock.ctx.updateState).not.toHaveBeenCalled();expect(mock.ctx.toggleTaskDone).not.toHaveBeenCalled();
});
it('keeps a task draft mounted and saves the same creator data and enum values after changing language',async()=>{
 mock.ctx.showModal='addTask';await act(async()=>root.render(<MemoryRouter><LanguageSwitcher/><Modals/></MemoryRouter>));const title=host.querySelector<HTMLInputElement>('input[placeholder="What needs doing?"]')!;await act(async()=>input(title,'Home'));await act(async()=>button('Polski').click());expect(host.querySelector('input[placeholder="Co trzeba zrobić?"]')).toBe(title);expect(title.value).toBe('Home');expect(host.querySelector('[role=dialog]')?.getAttribute('aria-label')).toBe('Nowe zadanie');await act(async()=>button('Dodaj zadanie').click());expect(mock.ctx.addTask).toHaveBeenCalledWith(expect.objectContaining({title:'Home',cat:'c',status:'todo',recurrence:'none'}));
});
