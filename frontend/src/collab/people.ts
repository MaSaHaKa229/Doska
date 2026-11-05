import { http } from '../api/http';

export interface Person {
  id: string;
  fullName: string;
  role: 'ADMIN' | 'TEACHER' | 'STUDENT';
}

/**
 * Справочник имён для подписей «кто нарисовал». Загружается один раз на
 * доску; неизвестные id подгружаются повторным запросом не чаще раза в 10 с.
 */
export class PeopleDirectory {
  private readonly byId = new Map<string, Person>();
  private loading: Promise<void> | null = null;
  private lastLoad = 0;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly boardId: string) {
    void this.load();
  }

  private load(): Promise<void> {
    this.loading ??= http
      .get<{ people: Person[] }>(`/api/boards/${this.boardId}/people`)
      .then((r) => {
        for (const p of r.people) this.byId.set(p.id, p);
        this.listeners.forEach((l) => l());
      })
      .catch(() => undefined)
      .finally(() => {
        this.lastLoad = Date.now();
        this.loading = null;
      });
    return this.loading;
  }

  /** Добавить известных (например, из присутствия). */
  remember(people: Iterable<Person>): void {
    for (const p of people) this.byId.set(p.id, p);
  }

  get(id: string): Person | undefined {
    const p = this.byId.get(id);
    if (!p && !this.loading && Date.now() - this.lastLoad > 10_000) void this.load();
    return p;
  }

  subscribe(l: () => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}
