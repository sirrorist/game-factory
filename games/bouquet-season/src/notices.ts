interface Notice {
  message: string;
  count: number;
  node: HTMLParagraphElement;
  timer: ReturnType<typeof setTimeout>;
}

// Только сообщения интерфейса: не входят в профиль или сохранение сезона.
export class Notices {
  #host: HTMLElement;
  #queue: Notice[] = [];

  constructor(host: HTMLElement) { this.#host = host; }

  dock(parent: HTMLElement, inPanel: boolean): void {
    this.#host.dataset.dock = inPanel ? 'panel' : 'world';
    if (this.#host.parentElement !== parent) parent.prepend(this.#host);
  }

  push(message: string): void {
    let item = this.#queue.find(entry => entry.message === message);
    if (item) {
      clearTimeout(item.timer);
      item.count++;
      this.#queue.splice(this.#queue.indexOf(item), 1);
    } else {
      if (this.#queue.length === 3) this.#remove(this.#queue[0]!);
      const node = document.createElement('p');
      node.className = 'notice';
      item = { message, count: 1, node, timer: undefined! };
    }
    const entry = item;
    entry.node.textContent = message + (entry.count > 1 ? ` ×${entry.count}` : '');
    entry.timer = setTimeout(() => this.#remove(entry), 6000);
    this.#queue.push(entry);
    this.#host.append(entry.node);
  }

  #remove(item: Notice): void {
    clearTimeout(item.timer);
    this.#queue = this.#queue.filter(entry => entry !== item);
    item.node.remove();
  }
}
