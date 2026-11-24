'use client';
import { useId, useState } from 'react';
import { useLang } from '../../lib/ui/lang';

/** Compact guidance, available by mouse, keyboard and touch. */
export function AssetHint({ text }: { text: string }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const id = useId();
  return <span className="inline-flex items-center align-middle">
    <button type="button" title={text} aria-label={t('Image specifications', 'مواصفات الصورة')} aria-expanded={open}
      aria-controls={id} onClick={() => setOpen(v => !v)} className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-gray-300 text-xs font-bold text-gray-600 hover:border-hatly-orange focus-visible:outline focus-visible:outline-2 focus-visible:outline-hatly-orange">!</button>
    {open && <span id={id} className="ms-2 inline-block max-w-xs whitespace-normal rounded-lg bg-gray-100 p-2 text-start text-xs font-normal text-gray-700">{text}</span>}
  </span>;
}
