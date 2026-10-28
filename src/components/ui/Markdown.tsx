import {tr,useUiLanguage} from '../../i18n';
import React from 'react';
import { Link } from 'react-router-dom';

/**
 * Tiny, safe markdown renderer for chat messages (no HTML injection — everything is React text).
 * Supports paragraphs, -/* and 1. lists, **bold**, *italic*, `code`, ``` code blocks and http(s) links.
 */
function inline(text: string, keyBase: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*|https?:\/\/[^\s)]+|\/search\?type=(?:task|meeting|vault|lecture)&id=[\w:-]{1,80})/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyBase}-${i++}`;
    if (tok.startsWith('**')) nodes.push(<strong key={key} className="font-bold text-primary">{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith('`')) nodes.push(<code key={key} className="font-mono text-[12px] px-1 bg-surface-high border border-border">{tok.slice(1, -1)}</code>);
    else if (tok.startsWith('/search?')) nodes.push(<Link key={key} to={tok} className="underline text-primary break-all">{tr("Open source")}</Link>);
    else if (tok.startsWith('http')) nodes.push(<a key={key} href={tok} target="_blank" rel="noopener noreferrer" className="underline text-secondary break-all">{tok}</a>);
    else nodes.push(<em key={key}>{tok.slice(1, -1)}</em>);
    last = m.index + tok.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export default function Markdown({ text }: { text: string }) {
  useUiLanguage();
  const blocks: React.ReactNode[] = [];
  const lines = text.replace(/\r/g, '').split('\n');
  let i = 0;
  let k = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim().startsWith('```')) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) code.push(lines[i++]);
      i++;
      blocks.push(<pre key={k++} className="font-mono text-[12px] p-2 bg-surface-high border border-border overflow-x-auto whitespace-pre">{code.join('\n')}</pre>);
      continue;
    }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*•]|\d+[.)])\s+/, ''));
        i++;
      }
      const Tag = ordered ? 'ol' : 'ul';
      blocks.push(
        <Tag key={k++} className={`${ordered ? 'list-decimal' : 'list-disc'} pl-5 flex flex-col gap-0.5`}>
          {items.map((it, j) => <li key={j}>{inline(it, `${k}-${j}`)}</li>)}
        </Tag>
      );
      continue;
    }
    if (/^#{1,4}\s+/.test(line)) {
      blocks.push(<div key={k++} className="font-bold text-text">{inline(line.replace(/^#{1,4}\s+/, ''), `h${k}`)}</div>);
      i++;
      continue;
    }
    if (!line.trim()) { i++; continue; }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^\s*([-*•]|\d+[.)])\s+/.test(lines[i]) && !lines[i].trim().startsWith('```') && !/^#{1,4}\s+/.test(lines[i])) {
      para.push(lines[i++]);
    }
    blocks.push(<p key={k++}>{para.flatMap((p, j) => (j ? [<br key={`br${j}`} />, ...inline(p, `${k}-${j}`)] : inline(p, `${k}-${j}`)))}</p>);
  }
  return <div className="flex flex-col gap-2">{blocks}</div>;
}
