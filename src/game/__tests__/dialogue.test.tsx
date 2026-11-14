// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {it,expect,vi,beforeEach,afterEach} from 'vitest';
import DialogueBox from '../systems/DialogueBox';
import {lostBinaryKingdom as sample} from '../samples/lost-binary-kingdom';
import {emptyProgress} from '../systems/quest';
let root:Root,host:HTMLDivElement;
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.useRealTimers();});
const button=(label:string)=>[...document.querySelectorAll('button')].find(b=>b.textContent===label)!;
it('shows full text in reduced motion, advances with E, exposes the mission only after the briefing and escapes untrusted text',async()=>{
 const spec=structuredClone(sample);spec.npcs[0].dialogue[0].text='<img src=x onerror=evil()> quoted data';const onQuest=vi.fn();
 await act(async()=>root.render(<DialogueBox spec={spec} npcId="byte" progress={emptyProgress()} reducedMotion onClose={vi.fn()} onQuest={onQuest}/>));expect(document.querySelector('p.min-h-20 span[aria-hidden]')?.textContent).toBe(spec.npcs[0].dialogue[0].text);expect(document.body.textContent).toContain('<img src=x');expect(document.querySelector('img')).toBe(null);expect(button('Accept mission')).toBeUndefined();
 await act(async()=>button('Next').dispatchEvent(new KeyboardEvent('keydown',{code:'KeyE',bubbles:true})));expect(document.body.textContent).toContain('Line 2 of 3');await act(async()=>button('Next').click());expect(document.body.textContent).toContain('Recognize powers of two.');await act(async()=>button('Accept mission').click());expect(onQuest).toHaveBeenCalledExactlyOnceWith('accept','power-path');
});
it('reveals typewriter text safely, supports show-all and previous/next, and clears its timer on unmount',async()=>{
 vi.useFakeTimers();const clear=vi.spyOn(window,'clearInterval');await act(async()=>root.render(<DialogueBox spec={sample} npcId="byte" progress={emptyProgress()} reducedMotion={false} onClose={vi.fn()} onQuest={vi.fn()}/>));
 const visible=()=>document.querySelector('p.min-h-20 span[aria-hidden]')?.textContent;
 expect(visible()).toBe('');await act(async()=>vi.advanceTimersByTime(60));expect(visible()!.length).toBeGreaterThan(0);await act(async()=>button('Show full line').click());expect(visible()).toBe(sample.npcs[0].dialogue[0].text);await act(async()=>vi.advanceTimersByTime(60));expect(visible()).toBe(sample.npcs[0].dialogue[0].text);await act(async()=>button('Next').click());expect(document.body.textContent).toContain('Line 2 of 3');await act(async()=>button('Previous').click());expect(document.body.textContent).toContain('Line 1 of 3');await act(async()=>root.unmount());expect(clear).toHaveBeenCalled();root=createRoot(host);
});
