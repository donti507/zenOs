import { beforeEach,expect,it,vi } from 'vitest';
import { MAX_SNAP_BYTES } from '../../../shared/snap';
import { prepareSnapFile } from '../snapFile';
const render=vi.hoisted(()=>vi.fn(async()=>({image:new Blob(['image'],{type:'image/jpeg'}),pages:3})));
vi.mock('../snapPdf',()=>({renderPdfPage:render}));
beforeEach(()=>render.mockClear());
it('does not load/render PDF code for photos and validates size/type before conversion',async()=>{
 const image=new File(['image'],'photo.png',{type:'image/png'});const signal=new AbortController().signal;
 expect((await prepareSnapFile(image,1,signal)).image).toBe(image);expect(render).not.toHaveBeenCalled();
 await expect(prepareSnapFile(new File([new Uint8Array(MAX_SNAP_BYTES+1)],'big.pdf',{type:'application/pdf'}),1,signal)).rejects.toThrow('5 MB');
 await expect(prepareSnapFile(new File(['x'],'bad.svg',{type:'image/svg+xml'}),1,signal)).rejects.toThrow('JPEG');expect(render).not.toHaveBeenCalled();
});
it('renders only the selected PDF page and supports cancellation',async()=>{
 const pdf=new File(['pdf'],'page.pdf',{type:'application/pdf'});const abort=new AbortController();
 expect((await prepareSnapFile(pdf,2,abort.signal)).pages).toBe(3);expect(render).toHaveBeenCalledExactlyOnceWith(pdf,2,abort.signal);
 abort.abort();await expect(prepareSnapFile(pdf,1,abort.signal)).rejects.toThrow('Cancelled');expect(render).toHaveBeenCalledOnce();
});
