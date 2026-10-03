import { Component } from "@angular/core";

@Component({
  standalone: true,
  selector: "app-home",
  template: `<iframe
    class="site-frame"
    src="/cocapec.html"
    title="Cocapec - O melhor café está aqui"
  ></iframe>`,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
        min-height: 100dvh;
        background: #fff;
      }
      .site-frame {
        display: block;
        width: 100%;
        height: 100%;
        min-height: 100dvh;
        border: 0;
      }
    `,
  ],
})
export class Home {}
