import Dexie, { Table } from 'dexie';
import { StadiumDocument } from '../stadium/schema';

export interface SavedStadiumRecord {
  id: string;
  name: string;
  updatedAt: number;
  capacity: number;
  document: StadiumDocument;
}

class StadiumForgeDatabase extends Dexie {
  projects!: Table<SavedStadiumRecord, string>;

  constructor() {
    super('StadiumForgeDB');
    this.version(1).stores({
      projects: 'id, name, updatedAt, capacity',
    });
  }
}

export const stadiumDb = new StadiumForgeDatabase();

export async function saveProjectToDb(
  doc: StadiumDocument,
  capacity: number
): Promise<void> {
  try {
    await stadiumDb.projects.put({
      id: doc.id,
      name: doc.name,
      updatedAt: doc.updatedAt,
      capacity,
      document: JSON.parse(JSON.stringify(doc)),
    });
  } catch (err) {
    console.warn('IndexedDB save skipped:', err);
  }
}

export async function listProjectsFromDb(): Promise<SavedStadiumRecord[]> {
  try {
    return await stadiumDb.projects.orderBy('updatedAt').reverse().toArray();
  } catch {
    return [];
  }
}

export async function deleteProjectFromDb(id: string): Promise<void> {
  try {
    await stadiumDb.projects.delete(id);
  } catch (err) {
    console.warn('IndexedDB delete error:', err);
  }
}
