import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Component, provideZonelessChangeDetection } from '@angular/core';
import { ReactiveFormsModule, FormControl } from '@angular/forms';
import { AppErrorComponent, AppInputDirective, CustomFormFieldComponent, MatLabelComponent } from './custom-form-field.component';
import { CustomOptionComponent, CustomSelectComponent } from '../custom-select/custom-select.component';

describe('CustomFormFieldComponent — Tailwind state-class getters (FWT-956)', () => {
  let component: CustomFormFieldComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection()],
      imports: [CustomFormFieldComponent],
    });
    const fixture = TestBed.createComponent(CustomFormFieldComponent);
    component = fixture.componentInstance;
  });

  describe('prefixSuffixColorClasses', () => {
    it('returns muted text when no state flags are set', () => {
      expect(component.prefixSuffixColorClasses).toContain('text-content-muted');
    });

    it('returns focus-border text when focused (no validity yet)', () => {
      component.focused = true;
      expect(component.prefixSuffixColorClasses).toContain('text-input-focus-border');
    });

    it('invalid takes precedence over focused', () => {
      component.focused = true;
      // isInvalid getter requires ngControl; we mimic by stubbing the getter behavior
      // through the underlying flag. Direct-property simulation of NgControl is heavier
      // than this test needs — test the getter via spying on isInvalid.
      Object.defineProperty(component, 'isInvalid', { get: () => true, configurable: true });
      expect(component.prefixSuffixColorClasses).toContain('text-danger');
    });

    it('valid takes precedence over focused (and falls back when not invalid)', () => {
      component.focused = true;
      Object.defineProperty(component, 'isInvalid', { get: () => false, configurable: true });
      Object.defineProperty(component, 'isValid', { get: () => true, configurable: true });
      expect(component.prefixSuffixColorClasses).toContain('text-success');
    });
  });

  describe('underlineColorClasses', () => {
    it('returns input-border bg when no state flags are set', () => {
      expect(component.underlineColorClasses).toContain('bg-input-border');
    });

    it('returns transparent when focused (and not yet validated)', () => {
      component.focused = true;
      expect(component.underlineColorClasses).toContain('bg-transparent');
    });

    it('invalid colors the underline danger regardless of focus', () => {
      component.focused = true;
      Object.defineProperty(component, 'isInvalid', { get: () => true, configurable: true });
      expect(component.underlineColorClasses).toContain('bg-danger');
    });

    it('valid colors the underline success', () => {
      Object.defineProperty(component, 'isInvalid', { get: () => false, configurable: true });
      Object.defineProperty(component, 'isValid', { get: () => true, configurable: true });
      expect(component.underlineColorClasses).toContain('bg-success');
    });
  });

  describe('rippleColorClasses', () => {
    it('default: focus-border bg, scale-x-0 (collapsed)', () => {
      const cls = component.rippleColorClasses;
      expect(cls).toContain('bg-input-focus-border');
      expect(cls).toContain('scale-x-0');
    });

    it('focused: scale-x-100 (expanded)', () => {
      component.focused = true;
      expect(component.rippleColorClasses).toContain('scale-x-100');
    });

    it('color=accent uses accent bg', () => {
      component.color = 'accent';
      expect(component.rippleColorClasses).toContain('bg-accent');
    });

    it('color=warn forces danger bg', () => {
      component.color = 'warn';
      expect(component.rippleColorClasses).toContain('bg-danger');
    });

    it('invalid forces danger bg even when color=accent', () => {
      component.color = 'accent';
      Object.defineProperty(component, 'isInvalid', { get: () => true, configurable: true });
      expect(component.rippleColorClasses).toContain('bg-danger');
    });

    it('valid uses success bg', () => {
      Object.defineProperty(component, 'isInvalid', { get: () => false, configurable: true });
      Object.defineProperty(component, 'isValid', { get: () => true, configurable: true });
      expect(component.rippleColorClasses).toContain('bg-success');
    });
  });
});

@Component({
  standalone: true,
  imports: [CustomFormFieldComponent, MatLabelComponent, CustomSelectComponent, CustomOptionComponent],
  template: `
    <app-form-field>
      <app-label>Service</app-label>
      <app-select><app-option value="a">alpha</app-option></app-select>
    </app-form-field>
    <app-form-field>
      <app-label>Plan</app-label>
      <app-select ariaLabel="Service plan"><app-option value="a">alpha</app-option></app-select>
    </app-form-field>
  `,
})
class LabelledSelectHostComponent {}

describe('CustomFormFieldComponent — label names a projected app-select', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  });

  it('points the combobox at the visible label', async () => {
    const fixture = TestBed.createComponent(LabelledSelectHostComponent);
    await fixture.whenStable();
    const [trigger] = fixture.nativeElement.querySelectorAll('[role="combobox"]');
    const id = trigger.getAttribute('aria-labelledby');
    expect(id).toBeTruthy();
    expect(document.getElementById(id)?.textContent?.trim()).toBe('Service');
  });

  it('leaves an explicit ariaLabel in charge', async () => {
    const fixture = TestBed.createComponent(LabelledSelectHostComponent);
    await fixture.whenStable();
    const [, trigger] = fixture.nativeElement.querySelectorAll('[role="combobox"]');
    expect(trigger.getAttribute('aria-labelledby')).toBeNull();
    expect(trigger.getAttribute('aria-label')).toBe('Service plan');
  });
});

@Component({
  standalone: true,
  imports: [CustomFormFieldComponent, AppInputDirective, AppErrorComponent, ReactiveFormsModule],
  template: `
    <app-form-field>
      <input appInput placeholder="Name" [formControl]="name">
      @if (name.hasError('taken')) {
        <app-error>This name has been taken, please try another.</app-error>
      }
      <div class="extra">Add tag...</div>
      <span appSuffix class="toggle">show</span>
    </app-form-field>
  `,
})
class ProjectedContentHostComponent {
  name = new FormControl('', (c) => (c.value === 'dup' ? { taken: true } : null));
}

describe('CustomFormFieldComponent — projects all of its content', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  });

  it('renders content that matches no named slot', async () => {
    const fixture = TestBed.createComponent(ProjectedContentHostComponent);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.extra')?.textContent).toBe('Add tag...');
  });

  it('puts an appSuffix element in the suffix slot', async () => {
    const fixture = TestBed.createComponent(ProjectedContentHostComponent);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.form-field-suffix .toggle')).toBeTruthy();
  });

  it('shows the app-error text in place of the generic message', async () => {
    const fixture = TestBed.createComponent(ProjectedContentHostComponent);
    fixture.componentInstance.name.setValue('dup');
    fixture.componentInstance.name.markAsDirty();
    await fixture.whenStable();
    const error = fixture.nativeElement.querySelector('.form-field-error');
    expect(error?.textContent?.trim()).toBe('This name has been taken, please try another.');
  });
});
