export type SpaceDiffLine = { kind: 'same' | 'added' | 'removed'; text: string; before: number | null; after: number | null };
/** Bound comparison work even for generated code with thousands of short lines. */
export function spaceLineDiff(before: string, after: string): { lines: SpaceDiffLine[]; coarse: boolean } {
  const a = before ? before.replace(/\r\n/g, '\n').split('\n') : [];
  const b = after ? after.replace(/\r\n/g, '\n').split('\n') : [];
  let start = 0, end = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  while (end < a.length-start && end < b.length-start && a[a.length-1-end] === b[b.length-1-end]) end++;
  const n=a.length-start-end, m=b.length-start-end;
  const coarse = n*m > 200000;
  const lines: SpaceDiffLine[]=[];
  let oldLine=1,newLine=1;
  const emit=(kind:SpaceDiffLine['kind'],text:string) => lines.push({kind,text,before:kind==='added'?null:oldLine++,after:kind==='removed'?null:newLine++});
  for(let i=0;i<start;i++) emit('same',a[i]);
  if(coarse) {
    for(let i=0;i<n;i++) emit('removed',a[start+i]);
    for(let j=0;j<m;j++) emit('added',b[start+j]);
  } else {
    const width=m+1, scores=new Uint32Array((n+1)*width);
    for(let i=n-1;i>=0;i--) for(let j=m-1;j>=0;j--)
      scores[i*width+j]=a[start+i]===b[start+j]?1+scores[(i+1)*width+j+1]:Math.max(scores[(i+1)*width+j],scores[i*width+j+1]);
    let i=0,j=0;
    while(i<n || j<m) {
      if(i<n && j<m && a[start+i]===b[start+j]) {emit('same',a[start+i]);i++;j++;}
      else if(i<n && (j===m || scores[(i+1)*width+j]>=scores[i*width+j+1])) emit('removed',a[start+i++]);
      else emit('added',b[start+j++]);
    }
  }
  for(let i=a.length-end;i<a.length;i++) emit('same',a[i]);
  // Keep two context lines around edits. Omitted line numbers reveal gaps.
  const visible=new Set<number>();
  lines.forEach((line,i)=>{if(line.kind!=='same') for(let j=Math.max(0,i-2);j<=Math.min(lines.length-1,i+2);j++) visible.add(j);});
  return {lines:lines.filter((_,i)=>visible.has(i)),coarse};
}
