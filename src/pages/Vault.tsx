import { useMemo, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { useZenos } from '../context/ZenosContext';
import { PageHeader, Icon, EmptyState, Modal, Field, btn, card, input, textarea } from '../components/ui/kit';

const hostOf = (url = '') => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };
const TINTS = ['bg-blue-500', 'bg-purple-500', 'bg-orange-500', 'bg-emerald-500', 'bg-pink-500', 'bg-cyan-500', 'bg-indigo-500'];
const tintFor = (s: string) => TINTS[[...s].reduce((n, c) => n + c.charCodeAt(0), 0) % TINTS.length];

export default function Vault() {
  const { state, addVaultItem, deleteVaultItem } = useZenos();
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', url: '', detail: '' });
  const [error, setError] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  const items = useMemo(
    () => state.vault.filter(v => !query || `${v.name} ${v.detail} ${v.url}`.toLowerCase().includes(query.toLowerCase())),
    [state.vault, query]
  );

  const save = async () => {
    let url = form.url.trim();
    if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
    if (!hostOf(url)) return setError('Enter a valid link, e.g. https://arxiv.org/abs/1234');
    await addVaultItem({ type: 'link', name: form.name.trim() || hostOf(url), url, detail: form.detail.trim() });
    setOpen(false);
    setForm({ name: '', url: '', detail: '' });
    setError('');
  };

  const copy = (id: string, url: string) => {
    navigator.clipboard?.writeText(url);
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div>
      <PageHeader
        title="Vault"
        subtitle={`${state.vault.length} saved link${state.vault.length === 1 ? '' : 's'}. Dante can see these and point you to them.`}
        actions={
          <>
            <div className="relative">
              <Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-on-surface-variant" />
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search vault" aria-label="Search vault"
                className="h-9 pl-9 pr-3 w-52 rounded-lg bg-surface-container-lowest shadow-soft outline-none focus:ring-2 focus:ring-primary/20" />
            </div>
            <button className={btn.primary} onClick={() => setOpen(true)}><Icon name="add_link" className="text-[18px]" />Add link</button>
          </>
        }
      />

      {items.length === 0 ? (
        <div className={card}>
          <EmptyState
            icon={query ? 'search_off' : 'folder_special'}
            title={query ? 'Nothing matches' : 'Your vault is empty'}
            text={query ? 'Try another search.' : 'Save papers, docs, portals and references so they are one click away.'}
            action={!query && <button className={btn.primary} onClick={() => setOpen(true)}>Add your first link</button>}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          <AnimatePresence initial={false}>
            {items.map((v, i) => {
              const host = hostOf(v.url);
              return (
                <motion.article
                  key={v.id}
                  layout={!reduce}
                  initial={reduce ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduce ? undefined : { opacity: 0, scale: 0.96 }}
                  transition={{ duration: 0.2, delay: reduce ? 0 : Math.min(i, 8) * 0.03 }}
                  className={`group ${card} p-4 flex flex-col gap-3 hover:shadow-md hover:-translate-y-0.5 transition-[box-shadow,transform]`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`w-10 h-10 shrink-0 rounded-xl ${tintFor(host || v.name)} text-white flex items-center justify-center font-semibold text-[16px]`} aria-hidden="true">
                      {v.type === 'file' ? <Icon name="description" className="text-[20px]" /> : (host || v.name).slice(0, 1).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      {v.url ? (
                        <a href={v.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-on-surface hover:text-primary line-clamp-2">{v.name}</a>
                      ) : (
                        <div className="font-semibold text-on-surface line-clamp-2">{v.name}</div>
                      )}
                      <div className="text-[12px] text-on-surface-variant truncate">{host || 'File'}</div>
                    </div>
                  </div>
                  {v.detail && <p className="text-[13px] text-on-surface-variant line-clamp-2">{v.detail}</p>}
                  <div className="flex items-center gap-1 mt-auto pt-1">
                    <span className="text-[11px] text-on-surface-variant mr-auto">{v.addedAt ? `Added ${new Date(v.addedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ''}</span>
                    {v.url && (
                      <>
                        <button className={btn.icon} onClick={() => copy(v.id, v.url!)} aria-label={`Copy link to ${v.name}`} title="Copy link">
                          <Icon name={copied === v.id ? 'check' : 'content_copy'} className="text-[18px]" />
                        </button>
                        <button className={btn.icon} title="Ask Dante" aria-label={`Ask Dante about ${v.name}`}
                          onClick={() => navigate('/dante', { state: { prompt: `Which of my tasks is "${v.name}" (${v.url}) useful for, and what should I do with it next?` } })}>
                          <Icon name="auto_awesome" className="text-[18px] text-primary" />
                        </button>
                      </>
                    )}
                    <button className={`${btn.icon} hover:text-error`} aria-label={`Delete ${v.name}`} title="Delete" onClick={() => confirm(`Delete “${v.name}”?`) && deleteVaultItem(v.id)}>
                      <Icon name="delete" className="text-[18px]" />
                    </button>
                  </div>
                </motion.article>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add link"
        width={460}
        footer={<><button className={btn.ghost} onClick={() => setOpen(false)}>Cancel</button><button className={btn.solid} onClick={save} disabled={!form.url.trim()}>Save link</button></>}
      >
        <Field label="Link"><input className={input} value={form.url} placeholder="https://…" onChange={e => setForm({ ...form, url: e.target.value })} onKeyDown={e => e.key === 'Enter' && save()} /></Field>
        <Field label="Name" hint="Leave empty to use the website name"><input className={input} value={form.name} placeholder="e.g. Neural Attention Maps" onChange={e => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="Note"><textarea className={textarea} value={form.detail} placeholder="Why is this useful?" onChange={e => setForm({ ...form, detail: e.target.value })} /></Field>
        {error && <p className="text-[13px] text-error" role="alert">{error}</p>}
      </Modal>
    </div>
  );
}
