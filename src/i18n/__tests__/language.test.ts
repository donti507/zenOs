// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {getUiLanguage,setUiLanguage,tr,uiLocale,speechLocale,quantity,UI_LANGUAGE_KEY} from '../index';
import {fmtDate,relDay,today} from '../../lib/utils';
import {buildDanteContext} from '../../lib/dante';
import {buildSystemPrompt} from '../../../server/prompt';
import {localizedRecapSpeech} from '../recaps';
import {polish} from '../pl';
import {breakdownPrompt} from '../../lib/postponement';
import {localizedAction} from '../actions';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import ts from 'typescript';
beforeEach(()=>{localStorage.clear();setUiLanguage('en');});
afterEach(()=>{vi.restoreAllMocks();setUiLanguage('en');});
it('persists explicit Polish, sets the HTML language and speech preference, and keeps unrelated data untouched',()=>{
 const data='[{"title":"Home","note":"Meetings"}]';localStorage.setItem('zenos_tasks',data);setUiLanguage('pl');expect(getUiLanguage()).toBe('pl');expect(document.documentElement.lang).toBe('pl');expect(localStorage.getItem(UI_LANGUAGE_KEY)).toBe('pl');expect(localStorage.getItem('zenos_voice_lang')).toBe('"pl-PL"');expect(speechLocale()).toBe('pl-PL');expect(uiLocale()).toBe('pl-PL');expect(localStorage.getItem('zenos_tasks')).toBe(data);
 setUiLanguage('en');expect(tr('New task')).toBe('New task');expect(localStorage.getItem('zenos_tasks')).toBe(data);
});
it('detects Polish browser preferences only without a valid saved override and reconciles cross-tab changes',()=>{
 vi.spyOn(navigator,'languages','get').mockReturnValue(['pl-PL','en-US']);localStorage.removeItem(UI_LANGUAGE_KEY);window.dispatchEvent(new StorageEvent('storage',{key:UI_LANGUAGE_KEY}));expect(getUiLanguage()).toBe('pl');
 localStorage.setItem(UI_LANGUAGE_KEY,'en');window.dispatchEvent(new StorageEvent('storage',{key:UI_LANGUAGE_KEY}));expect(getUiLanguage()).toBe('en');expect(document.documentElement.lang).toBe('en');
 localStorage.setItem(UI_LANGUAGE_KEY,'unsupported');window.dispatchEvent(new StorageEvent('storage',{key:UI_LANGUAGE_KEY}));expect(getUiLanguage()).toBe('pl');
});
it('keeps switching and translating when local storage is blocked',()=>{
 vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('Blocked');});expect(()=>setUiLanguage('pl')).not.toThrow();expect(tr('Calendar')).toBe('Kalendarz');expect(document.documentElement.lang).toBe('pl');
});
it('interpolates content once as text, keeps unknown messages and whitespace, and handles Polish number forms',()=>{
 setUiLanguage('pl');const content='<script>alert(1)</script> {{1}}';expect(tr('Delete “{{0}}”?',content)).toBe(`Usunąć „${content}”?`);expect(tr('Unknown provider message')).toBe('Unknown provider message');expect(tr('   ')).toBe('   ');expect(tr(' Today ')).toBe(' Dzisiaj ');
 expect([1,2,5,12,22].map(n=>quantity(n,'task'))).toEqual(['1 zadanie','2 zadania','5 zadań','12 zadań','22 zadania']);setUiLanguage('en');expect(quantity(2,'task')).toBe('2 tasks');
});
it('localizes presentation dates and Dante preference without changing calendar date keys or authored content',()=>{
 setUiLanguage('pl');expect(fmtDate('2026-10-28')).toMatch(/paź/);expect(relDay(today())).toBe('Dzisiaj');const state:any={tasks:[{id:'1',title:'Home',note:'Meeting notes',status:'todo'}],categories:[],vault:[],meetings:[],completionLog:[]};const before=JSON.stringify(state);const context=buildDanteContext(state,[],'Anna','pl-PL');expect(context.uiLanguage).toBe('pl');expect(buildSystemPrompt(context)).toContain('Interface language: Polish');expect(context.tasks[0].title).toBe('Home');expect(JSON.stringify(state)).toBe(before);const handoff=breakdownPrompt(state.tasks[0]);expect(handoff).toContain('Pomóż mi');expect(handoff).toContain('add_task_steps');expect(handoff).toContain('Home');
});
it('reads Polish recaps with original task titles and canonical counts, not machine-translated saved data',()=>{
 setUiLanguage('pl');const recap:any={tasksDone:5,bestDay:'2026-10-28',bestDayCount:3,streak:2,slippedCount:1,slippedTasks:[{title:'Home'}],suggestion:'Choose one slipped task and give it a smaller first step.'};const before=JSON.stringify(recap);const speech=localizedRecapSpeech(recap);expect(speech).toContain('Twoje podsumowanie tygodnia');expect(speech).toContain('2 dni');expect(speech).toContain('Home');expect(speech).not.toContain('Wednesday');expect(JSON.stringify(recap)).toBe(before);
});
it('provides Polish for every literal application translation key and never invents interpolation fields',()=>{
 const missing=new Set<string>();const scan=(folder:string)=>{for(const entry of readdirSync(folder,{withFileTypes:true})){const file=join(folder,entry.name);if(entry.isDirectory()){if(entry.name!=='__tests__')scan(file);continue;}if(!/\.tsx?$/.test(file)||file.endsWith('/pl.ts'))continue;const source=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,file.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);const visit=(node:ts.Node)=>{if(ts.isCallExpression(node)&&node.expression.getText(source)==='tr'&&node.arguments[0]&&ts.isStringLiteral(node.arguments[0])){const key=node.arguments[0].text.trim();if(!polish[key])missing.add(key);}ts.forEachChild(node,visit);};visit(source);}};scan('src');expect([...missing]).toEqual([]);
 for(const [key,value] of Object.entries(polish)){const original=new Set(key.match(/\{\{\d+\}\}/g)||[]);for(const placeholder of value.match(/\{\{\d+\}\}/g)||[])expect(original.has(placeholder),`${key}: ${placeholder}`).toBe(true);}
});

it('localizes generated action wrappers and quota errors without translating captured user titles',()=>{setUiLanguage('pl');expect(localizedAction('Create task “Home”')).toBe('Utwórz zadanie „Home”');expect(localizedAction('Add 2 steps to “Calendar”')).toBe('Dodaj kroki (2) do „Calendar”');expect(tr('Too many messages. Wait 12s and try again.')).toContain('Poczekaj 12 s');expect(tr('Transcribing section 1 of 3…')).toBe('Transkrypcja części 1 z 3…');expect(tr('You’ve used your 20 Dante messages for today. Take a breather and come back after midnight UTC.')).toContain('20 wiadomości');});
