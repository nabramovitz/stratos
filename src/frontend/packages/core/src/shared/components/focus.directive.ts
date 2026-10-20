import { Directive, ElementRef, Input, NgZone, OnChanges, inject } from '@angular/core';

@Directive({
selector: '[appFocus]',
standalone: true,
// Marks the target so a container (e.g. app-steppers on a step change) can
// find it: the input fires only on change, not when the element is shown.
host: { '[attr.data-app-focus]': 'appFocus || null' }
})
export class FocusDirective implements OnChanges {
  @Input() appFocus!: boolean;

  private element = inject(ElementRef);
  private ngZone = inject(NgZone);

  public ngOnChanges() {
    if (this.appFocus) {
      this.focus();
    }
  }

  private focus() {
    this.ngZone.runOutsideAngular(() => {
      setTimeout(() => this.element.nativeElement.focus(), 250);
    });
  }
}
