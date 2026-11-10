import { beforeEach, describe, expect, it, vi } from 'vitest';

// The store's autosave timer uses window.setTimeout; vitest runs these suites under Node.
vi.stubGlobal('window', globalThis);

const saved = new Map<string, unknown>();
vi.mock('../db', () => ({
  saveProjectToDb: vi.fn(async (doc: { id: string }) => {
    saved.set(doc.id, doc);
  }),
  listProjectsFromDb: vi.fn(async () => [...saved.values()]),
  deleteProjectFromDb: vi.fn(async (id: string) => {
    saved.delete(id);
  }),
}));

const { useStadiumStore } = await import('../useStadiumStore');
const { STADIUM_PRESETS } = await import('../../stadium/presets');

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('project persistence', () => {
  beforeEach(() => saved.clear());

  it('does not save an opened example or blank project until it is edited', async () => {
    const store = useStadiumStore.getState();
    store.loadPreset(STADIUM_PRESETS[0].id);
    await settle();
    store.loadPreset(STADIUM_PRESETS[1].id);
    await settle();
    store.newBlankProject();
    await settle();
    expect(saved.size).toBe(0);
    expect(useStadiumStore.getState().lastSavedAt).toBeNull();

    vi.useFakeTimers();
    try {
      useStadiumStore.getState().setProjectName('Mon stade');
      await vi.runAllTimersAsync();
    } finally {
      vi.useRealTimers();
    }
    expect([...saved.keys()]).toEqual([useStadiumStore.getState().doc.id]);
  });

  it('saves a duplicate at once', async () => {
    useStadiumStore.getState().duplicateProject();
    await settle();
    expect(saved.size).toBe(1);
  });
});
