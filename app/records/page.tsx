// app/records/page.tsx
// /records へのアクセスをpublic/records.htmlにリダイレクト

import { redirect } from 'next/navigation';

export default function RecordsPage() {
  redirect('/records.html');
}
