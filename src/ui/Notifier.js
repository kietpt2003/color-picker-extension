export default class Notifier {
  constructor(element) {
    this.element = element;
    this.timer = null;
  }

  show(message, error = false) {
    clearTimeout(this.timer);
    this.element.textContent = message;
    this.element.classList.toggle('error', error);
    this.element.hidden = false;
    this.timer = setTimeout(() => {
      this.element.hidden = true;
    }, error ? 8000 : 3500);
  }
}
