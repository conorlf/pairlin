import { openai } from './openai';
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(__dirname, '../../data');

const DOC_FILES = [
  'ioss-rules.txt',
  'eu-tariff-schedules.txt',
  'courier-docs/anpost-customs.txt',
  'courier-docs/dhl-duty-rates.txt',
  'courier-docs/fedex-customs.txt',
];

export async function initVectorStore(): Promise<string> {
  const existingId = process.env.OPENAI_VECTOR_STORE_ID;

  if (existingId) {
    console.log(`[vectorStore] Using existing store: ${existingId}`);
    return existingId;
  }

  console.log('[vectorStore] Creating new vector store...');
  const store = await openai.vectorStores.create({ name: 'landedcost-customs-rules' });

  const files: File[] = DOC_FILES.map(rel => {
    const filePath = path.join(DATA_DIR, rel);
    const content = fs.readFileSync(filePath);
    const blob = new Blob([content], { type: 'text/plain' });
    return new File([blob], path.basename(rel), { type: 'text/plain' });
  });

  console.log('[vectorStore] Uploading documents...');
  await openai.vectorStores.fileBatches.uploadAndPoll(store.id, { files });

  console.log(`[vectorStore] Store ready: ${store.id}`);
  console.log(`[vectorStore] Set env: OPENAI_VECTOR_STORE_ID=${store.id}`);

  return store.id;
}
