export class InputQueue {
  constructor() {
    /** @type {Array<{role: string, content: string}>} */
    this._items = [];
    /** @type {Array<{from: string, content: string, triggerTurn?: boolean}>} */
    this._mailbox = [];
  }

  /** @returns {number} */
  size() { return this._items.length; }

  /** @returns {number} */
  mailboxSize() { return this._mailbox.length; }

  enqueue(item) {
    this._items.push(item);
  }

  drain() {
    const items = this._items.splice(0);
    this._mailbox.splice(0);
    return items;
  }

  enqueueMailbox(msg) {
    this._mailbox.push(msg);
  }

  drainMailbox() {
    return this._mailbox.splice(0);
  }

  hasTriggerTurn() {
    return this._mailbox.some(m => m.triggerTurn === true);
  }
}
