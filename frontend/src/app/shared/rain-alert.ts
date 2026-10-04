import { ChangeDetectionStrategy, Component, computed, effect, inject, input, untracked } from "@angular/core";
import { IonIcon } from "@ionic/angular/standalone";
import { addIcons } from "ionicons";
import { rainyOutline, sunnyOutline } from "ionicons/icons";
import { forecastIcon, HgWeather, RAIN_ALERT, SUN_LABEL } from "../core/hg-weather";

@Component({
  selector: "app-rain-alert",
  standalone: true,
  imports: [IonIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: "display: inline-flex; align-items: center;", "[attr.data-date]": "date()" },
  template: `
    @if (showSpinner()) {
      <span class="rain-alert is-loading" style="display: flex; justify-content: center;" role="status" aria-live="polite" aria-label="Consultando a previsão do tempo">
        <span class="rain-spinner" aria-hidden="true"></span>
      </span>
    } @else if (icon() === "rain") {
      <span class="rain-alert" tabindex="0" role="img" [attr.aria-label]="rainMessage" (mousedown)="$event.preventDefault()" (click)="$event.preventDefault(); $event.stopPropagation()">
        <ion-icon name="rainy-outline" aria-hidden="true" />
        <span class="rain-tooltip" role="tooltip">{{ rainMessage }}</span>
      </span>
    } @else {
      <span class="rain-alert is-sun" style="display: flex; justify-content: center;" tabindex="0" role="img" [attr.aria-label]="sunMessage" (mousedown)="$event.preventDefault()" (click)="$event.preventDefault(); $event.stopPropagation()">
        <ion-icon name="sunny-outline" aria-hidden="true" />
        <span class="rain-tooltip" role="tooltip">{{ sunMessage }}</span>
      </span>
    }
  `,
})
export class RainAlert {
  date = input("");
  iconOnly = input(false);
  private weather = inject(HgWeather);
  readonly rainMessage = RAIN_ALERT;
  readonly sunMessage = SUN_LABEL;
  private forecast = computed(() => this.weather.day(this.date()));
  showSpinner = computed(() => !this.iconOnly() && this.weather.pending().has(this.date()) && !this.forecast());
  icon = computed(() => forecastIcon(this.forecast()));

  constructor() {
    addIcons({ rainyOutline, sunnyOutline });
    effect(() => {
      const date = this.date();
      untracked(() => void this.weather.load(date));
    });
  }
}
