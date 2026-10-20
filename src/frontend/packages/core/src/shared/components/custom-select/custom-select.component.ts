import { AfterContentInit, AfterViewInit, ChangeDetectionStrategy, Component, ContentChildren, DestroyRef, ElementRef, EventEmitter, Input, Output, QueryList, ViewChild, afterRenderEffect, booleanAttribute, computed, forwardRef, inject, input, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NgClass } from '@angular/common';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { Combobox, ComboboxPopup, ComboboxWidget } from '@angular/aria/combobox';
import { Listbox, Option } from '@angular/aria/listbox';
import { AppBusyComponent } from '../busy-indicator/busy-indicator.component';


export interface MatSelectChange {
  source: CustomSelectComponent;
  value: any;
}

/**
 * One choice in an `app-select`. It holds data only: `app-select` renders
 * the real option (role, id, aria-selected, keys) inside its own listbox,
 * because the listbox directive cannot be reached through `<ng-content>`.
 * This view exists to read the projected text, which becomes the option's
 * label when no `label` is given.
 */
@Component({
  selector: 'app-option',
  template: `<span #optionContent><ng-content></ng-content></span>`,
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CustomOptionComponent implements AfterViewInit {
  readonly value = input<any>();
  readonly label = input<string>();
  readonly disabled = input(false, { transform: booleanAttribute });

  @ViewChild('optionContent', { static: true }) optionContent!: ElementRef<HTMLElement>;

  private readonly projectedText = signal('');

  // Only fall back to `value` when it is itself a string: options may
  // carry object values ([value]="domain"), and the label must always be
  // a string.
  readonly displayText = computed(() => {
    const value = this.value();
    return this.label() || this.projectedText() || (typeof value === 'string' ? value : '');
  });

  ngAfterViewInit() {
    this.projectedText.set(this.optionContent.nativeElement.textContent?.trim() ?? '');
  }
}

let nextSelectId = 0;

/**
 * A select-only combobox (WAI-ARIA APG pattern) built on `@angular/aria`.
 * Focus stays on the trigger; the active option is announced through
 * aria-activedescendant. Keys: Down, Enter or Space open the list; Up,
 * Down, Home, End, Page Up and Page Down move; Enter or Space select;
 * printable characters jump to a matching option; Escape closes without a
 * change; Tab closes and moves on.
 */
@Component({
  selector: 'app-select',
  templateUrl: './custom-select.component.html',
  styleUrls: ['./custom-select.component.css'],
  standalone: true,
  imports: [NgClass, AppBusyComponent, Combobox, ComboboxPopup, ComboboxWidget, Listbox, Option],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => CustomSelectComponent),
      multi: true
    }
  ],
  host: {
    // Lets callers (e.g. appFocus) focus the host; focus goes on to the trigger.
    tabindex: '-1',
    '(focus)': 'focusTrigger()'
  }
})
export class CustomSelectComponent implements ControlValueAccessor, AfterContentInit {
  private destroyRef = inject(DestroyRef);

  @Input() placeholder = '';
  /** Accessible name when the select has no visible label. Defaults to the placeholder. */
  @Input() ariaLabel = '';
  /** Id of a visible label; `<app-form-field>` sets it from its `<app-label>`. */
  @Input() ariaLabelledby = '';
  @Input({ transform: booleanAttribute }) multiple = false;
  @Input() required = false;
  @Input() name!: string;
  @Input() id!: string;
  @Input() invalid = false;
  @Input() errorMessage = '';
  @Input() autoSelectSingleOption = true; // Auto-select when only one option exists
  @Input({ transform: booleanAttribute }) loading = false;

  @Input()
  get disabled(): boolean {
    return this.disabledState();
  }
  set disabled(val: boolean) {
    this.disabledState.set(!!val);
  }

  @Input()
  get value(): any {
    return this.multiple ? this.selectedValues() : this.selectedValues()[0];
  }
  set value(val: any) {
    this.writeValue(val);
  }

  @Output() selectionChange = new EventEmitter<MatSelectChange>();
  @Output() valueChange = new EventEmitter<any>();

  // strict: @ContentChildren is populated by Angular before ngAfterContentInit
  @ContentChildren(CustomOptionComponent) options!: QueryList<CustomOptionComponent>;
  @ViewChild('selectTrigger', { static: true }) selectTrigger!: ElementRef<HTMLElement>;

  private readonly listbox = viewChild(Listbox);

  readonly expanded = signal(false);
  /**
   * VoiceOver in Safari says nothing about the list opening when
   * aria-activedescendant is set in the same update, so the active option
   * is exposed 300 ms after it opens. Exposing it after one render was not
   * enough. NOTE: a measured delay, not an event; re-check it with the
   * VoiceOver run when Safari or @angular/aria change.
   */
  readonly activeShown = signal(false);
  readonly selectedValues = signal<any[]>([]);
  readonly optionList = signal<CustomOptionComponent[]>([]);
  private readonly disabledState = signal(false);
  private readonly fallbackId = `app-select-${nextSelectId++}`;

  readonly dropdownTop = signal('0px');
  readonly dropdownLeft = signal('0px');
  readonly dropdownWidth = signal('0px');

  readonly displayValue = computed(() => {
    const selected = this.selectedValues();
    if (selected.length === 0) return '';
    if (this.multiple && selected.length > 1) return `${selected.length} selected`;
    // When the matching option isn't there yet (async @for not rendered),
    // show empty so the placeholder displays instead of a raw value/GUID.
    return this.optionList().find(opt => opt.value() === selected[0])?.displayText() ?? '';
  });

  /**
   * Longest option text by character count. Rendered as an invisible
   * sizer in the trigger so the trigger width stays stable once the
   * options arrive — picking a shorter value won't shrink the control.
   */
  readonly longestOptionText = computed(() =>
    this.optionList().reduce((longest, opt) => {
      const text = opt.displayText();
      return text.length > longest.length ? text : longest;
    }, ''));

  get accessibleName(): string | null {
    return this.ariaLabel || this.placeholder || null;
  }

  get listboxId(): string {
    return 'select-listbox-' + (this.id || this.name || this.fallbackId);
  }

  private _onChange = (_value: any) => {};
  private _onTouched = () => {};

  constructor() {
    afterRenderEffect(() => {
      if (this.expanded()) {
        this.listbox()?.scrollActiveItemIntoView({ block: 'nearest' });
      }
    });
  }

  ngAfterContentInit() {
    this.optionList.set(this.options.toArray());
    this.options.changes.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.optionList.set(this.options.toArray());
      this.checkAutoSelect();
    });
    this.checkAutoSelect();
  }

  private checkAutoSelect() {
    if (this.autoSelectSingleOption &&
        !this.multiple &&
        this.selectedValues().length === 0 &&
        this.options?.length === 1) {
      const singleOption = this.options.first;
      if (singleOption && !singleOption.disabled()) {
        this.commit([singleOption.value()]);
      }
    }
  }

  focusTrigger() {
    this.selectTrigger.nativeElement.focus();
  }

  onExpandedChange(open: boolean) {
    if (open) {
      // Position before the list shows, so it does not flash at the wrong place.
      const rect = this.selectTrigger.nativeElement.getBoundingClientRect();
      this.dropdownTop.set(`${rect.bottom + 4}px`);
      this.dropdownLeft.set(`${rect.left}px`);
      this.dropdownWidth.set(`${rect.width}px`);
      setTimeout(() => this.activeShown.set(this.expanded()), 300);
    }
    this.activeShown.set(false);
    this.expanded.set(open);
    this._onTouched();
  }

  /** The listbox changed its value: a click, Enter or Space on an option. */
  onListboxValueChange(values: any[]) {
    if (this.multiple) {
      this.commit(values);
      return;
    }
    // Enter or a click on the chosen option toggles it off in the listbox;
    // a single select keeps it. A new array makes the listbox take it back.
    if (values.length === 0) {
      this.selectedValues.set([...this.selectedValues()]);
      return;
    }
    // A null/undefined option (e.g. "None") clears the selection.
    const picked = values[0];
    this.commit(picked === null || picked === undefined ? [] : [picked]);
  }

  /** A single select closes once a choice is made, even an unchanged one. */
  onOptionCommit() {
    if (this.multiple) return;
    this.expanded.set(false);
    this.focusTrigger();
  }

  private commit(values: any[]) {
    this.selectedValues.set(values);
    const value = this.multiple ? values : (values[0] ?? null);
    this._onChange(value);
    this.selectionChange.emit({ source: this, value });
    this.valueChange.emit(value);
  }

  // ControlValueAccessor implementation
  writeValue(value: any): void {
    // Interaction lock: ignore external writes while the user is choosing
    // in an open multi-select. Always allow clears (reset button).
    if (this.multiple && this.expanded() && value !== null && value !== undefined &&
        (!Array.isArray(value) || value.length > 0)) {
      return;
    }

    if (this.multiple && Array.isArray(value)) {
      this.selectedValues.set(value);
    } else if (!this.multiple && value !== undefined && value !== null) {
      this.selectedValues.set([value]);
    } else {
      this.selectedValues.set([]);
    }
  }

  registerOnChange(fn: any): void {
    this._onChange = fn;
  }

  registerOnTouched(fn: any): void {
    this._onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabledState.set(isDisabled);
  }
}
