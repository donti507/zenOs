// @vitest-environment jsdom
import {it,expect,vi} from 'vitest';
import {bindKeyboard} from '../engine/input';
it('moves only from its focused viewport, preserves app shortcuts and releases held input on blur and cleanup',()=>{
 const host=document.createElement('div');host.tabIndex=0;const field=document.createElement('input');host.append(field);document.body.append(host);const move=vi.fn(),pause=vi.fn(),interact=vi.fn();const off=bindKeyboard(host,move,pause,interact);
 field.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyW',bubbles:true}));expect(move).not.toHaveBeenCalled();host.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyW',ctrlKey:true,bubbles:true}));expect(move).not.toHaveBeenCalled();
 host.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyW',bubbles:true}));expect(move).toHaveBeenLastCalledWith({x:0,y:-1});host.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyD',bubbles:true}));expect(move.mock.lastCall![0].x).toBeCloseTo(Math.SQRT1_2);
 window.dispatchEvent(new Event('blur'));expect(move).toHaveBeenLastCalledWith({x:0,y:0});host.dispatchEvent(new KeyboardEvent('keydown',{code:'Escape',bubbles:true}));expect(pause).toHaveBeenCalledOnce();host.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyE',bubbles:true}));host.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyE',repeat:true,bubbles:true}));host.dispatchEvent(new KeyboardEvent('keydown',{code:'Space',bubbles:true}));expect(interact).toHaveBeenCalledTimes(2);expect(move).toHaveBeenLastCalledWith({x:0,y:0});off();const count=move.mock.calls.length;host.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyW',bubbles:true}));expect(move).toHaveBeenCalledTimes(count);host.remove();
});
