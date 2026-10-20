import { Component, signal } from '@angular/core';
import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi, onTestFinished } from 'vitest';

import { CustomOptionComponent, CustomSelectComponent } from './custom-select.component';

// Regression for the Add Route domain dropdown: options bound to OBJECT
// values ([value]="domain") crashed the select on first open — the
// display text fell back to the raw value. displayText must always be a
// string.
@Component({
  standalone: true,
  imports: [CustomSelectComponent, CustomOptionComponent],
  template: `
    <app-select placeholder="Domain">
      @for (item of items; track item.entity.name) {
        <app-option [value]="item">{{ item.entity.name }}</app-option>
      }
    </app-select>
  `,
})
class ObjectValueHostComponent {
  items = [
    { entity: { name: 'run.example.com' } },
    { entity: { name: 'apps.internal' } },
  ];
}

// The crash shape from #5523's Add Route dropdown: the projected option
// text resolved to '' (stale `domain?.entity?.name` against a flat DTO).
@Component({
  standalone: true,
  imports: [CustomSelectComponent, CustomOptionComponent],
  template: `
    <app-select placeholder="Domain">
      @for (item of items; track item.name) {
        <app-option [value]="item">{{ item.missing?.name }}</app-option>
      }
    </app-select>
  `,
})
class EmptyTextObjectValueHostComponent {
  items: { name: string; missing?: { name: string } }[] = [
    { name: 'run.example.com' },
    { name: 'apps.internal' },
  ];
}

@Component({
  standalone: true,
  imports: [CustomSelectComponent, CustomOptionComponent],
  template: `
    <app-select placeholder="Org" [autoSelectSingleOption]="false" (valueChange)="picked.set($event)">
      <app-option [value]="null">None</app-option>
      @for (name of names; track name) {
        <app-option [value]="name" [disabled]="name === 'delta'">{{ name }}</app-option>
      }
    </app-select>
  `,
})
class OrgHostComponent {
  names = ['alpha', 'bravo', 'charlie', 'delta', 'echo'];
  picked = signal<string | null | undefined>(undefined);
}

@Component({
  standalone: true,
  imports: [CustomSelectComponent, CustomOptionComponent],
  template: `
    <app-select placeholder="Space" (valueChange)="picked.set($event)">
      <app-option value="only">only</app-option>
    </app-select>
  `,
})
class SingleOptionHostComponent {
  picked = signal<string | undefined>(undefined);
}

const key = (target: EventTarget, k: string) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));

function selectOf(fixture: ComponentFixture<unknown>): CustomSelectComponent {
  return fixture.debugElement.children[0].componentInstance as CustomSelectComponent;
}

function triggerOf(fixture: ComponentFixture<unknown>): HTMLElement {
  return fixture.nativeElement.querySelector('[role="combobox"]');
}

function optionTexts(fixture: ComponentFixture<unknown>): string[] {
  return [...fixture.nativeElement.querySelectorAll('[role="option"]')]
    .map((el: Element) => el.textContent?.trim() ?? '');
}

function activeText(fixture: ComponentFixture<unknown>): string | undefined {
  const id = triggerOf(fixture).getAttribute('aria-activedescendant');
  return id ? fixture.nativeElement.querySelector(`[id="${id}"]`)?.textContent?.trim() : undefined;
}

describe('CustomSelectComponent with object-valued options', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection()],
    });
  });

  it('displayText is always a string', async () => {
    const fixture = TestBed.createComponent(ObjectValueHostComponent);
    await fixture.whenStable();
    selectOf(fixture).options.forEach(opt => expect(typeof opt.displayText()).toBe('string'));
  });

  it('opens without throwing when options carry object values', async () => {
    const fixture = TestBed.createComponent(ObjectValueHostComponent);
    await fixture.whenStable();
    triggerOf(fixture).click();
    await fixture.whenStable();
    const listbox = fixture.nativeElement.querySelector('[role="listbox"]');
    expect(listbox).toBeTruthy();
    expect(listbox.textContent).toContain('run.example.com');
  });

  it('opens without throwing even when option text is empty', async () => {
    const fixture = TestBed.createComponent(EmptyTextObjectValueHostComponent);
    await fixture.whenStable();
    selectOf(fixture).options.forEach(opt => expect(typeof opt.displayText()).toBe('string'));
    triggerOf(fixture).click();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelectorAll('[role="option"]').length).toBe(2);
  });
});

describe('CustomSelectComponent as a select-only combobox', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection()],
    });
  });

  async function open() {
    const fixture = TestBed.createComponent(OrgHostComponent);
    await fixture.whenStable();
    const trigger = triggerOf(fixture);
    trigger.focus();
    key(trigger, 'ArrowDown');
    await fixture.whenStable();
    return { fixture, trigger };
  }

  it('names the combobox and the listbox from the placeholder', async () => {
    const { fixture, trigger } = await open();
    expect(trigger.getAttribute('aria-label')).toBe('Org');
    expect(trigger.getAttribute('aria-haspopup')).toBe('listbox');
    const listbox = fixture.nativeElement.querySelector('[role="listbox"]');
    expect(listbox.getAttribute('aria-label')).toBe('Org');
    expect(trigger.getAttribute('aria-controls')).toBe(listbox.id);
  });

  it('opens with ArrowDown and renders real options', async () => {
    const { fixture, trigger } = await open();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(optionTexts(fixture)).toEqual(['None', 'alpha', 'bravo', 'charlie', 'delta', 'echo']);
    const options = [...fixture.nativeElement.querySelectorAll('[role="option"]')] as HTMLElement[];
    options.forEach(o => {
      expect(o.id).toBeTruthy();
      expect(o.getAttribute('aria-selected')).toBe('false');
    });
    expect(options[4].getAttribute('aria-disabled')).toBe('true');
  });

  it('moves the active option with the arrow keys and keeps focus on the trigger', async () => {
    const { fixture, trigger } = await open();
    key(trigger, 'ArrowDown');
    await fixture.whenStable();
    key(trigger, 'ArrowDown');
    await fixture.whenStable();
    expect(activeText(fixture)).toBe('bravo');
    expect(document.activeElement).toBe(trigger);
  });

  it('selects the active option with Enter, closes, and reports the value', async () => {
    const { fixture, trigger } = await open();
    key(trigger, 'ArrowDown');
    await fixture.whenStable();
    expect(activeText(fixture)).toBe('alpha');
    key(trigger, 'Enter');
    await fixture.whenStable();

    expect(fixture.componentInstance.picked()).toBe('alpha');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.textContent).toContain('alpha');
    expect(document.activeElement).toBe(trigger);
  });

  it('jumps to an option by typing its first letter', async () => {
    const { fixture, trigger } = await open();
    key(trigger, 'c');
    await fixture.whenStable();
    expect(activeText(fixture)).toBe('charlie');
  });

  // APG: a disabled option stays reachable, so a screen reader user hears
  // it is there, but it cannot be chosen.
  it('reaches the disabled option but does not select it', async () => {
    const { fixture, trigger } = await open();
    key(trigger, 'c');
    await fixture.whenStable();
    key(trigger, 'ArrowDown');
    await fixture.whenStable();
    expect(activeText(fixture)).toBe('delta');

    key(trigger, 'Enter');
    await fixture.whenStable();
    expect(fixture.componentInstance.picked()).toBeUndefined();
  });

  it('clears the value when the None option is chosen', async () => {
    const { fixture, trigger } = await open();
    key(trigger, 'ArrowDown');
    await fixture.whenStable();
    key(trigger, 'Enter');
    await fixture.whenStable();
    expect(fixture.componentInstance.picked()).toBe('alpha');

    key(trigger, 'ArrowDown');
    await fixture.whenStable();
    key(trigger, 'Home');
    await fixture.whenStable();
    key(trigger, 'Enter');
    await fixture.whenStable();
    expect(fixture.componentInstance.picked()).toBeNull();
    expect(selectOf(fixture).value).toBeUndefined();
  });

  it('forwards focus from the host to the trigger', async () => {
    const fixture = TestBed.createComponent(OrgHostComponent);
    await fixture.whenStable();
    (fixture.nativeElement.querySelector('app-select') as HTMLElement).focus();
    expect(document.activeElement).toBe(triggerOf(fixture));
  });

  it('auto-selects a single option', async () => {
    const fixture = TestBed.createComponent(SingleOptionHostComponent);
    await fixture.whenStable();
    expect(fixture.componentInstance.picked()).toBe('only');
    expect(triggerOf(fixture).textContent).toContain('only');
  });
});

describe('CustomSelectComponent and the Escape key', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection()],
    });
  });

  // Dialogs and the side panel close on any Escape that reaches the
  // document, so each case also records whether the key got that far.
  async function open() {
    const fixture = TestBed.createComponent(OrgHostComponent);
    await fixture.whenStable();
    const trigger = triggerOf(fixture);
    trigger.focus();
    trigger.click();
    await fixture.whenStable();
    const reachedDocument = vi.fn();
    document.addEventListener('keydown', reachedDocument);
    onTestFinished(() => document.removeEventListener('keydown', reachedDocument));
    return { fixture, trigger, reachedDocument };
  }

  it('closes the open list and keeps the key from the document', async () => {
    const { fixture, trigger, reachedDocument } = await open();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    key(trigger, 'Escape');
    await fixture.whenStable();

    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
    expect(fixture.componentInstance.picked()).toBeUndefined();
    expect(reachedDocument).not.toHaveBeenCalled();
    // A closed list must not leave the combobox pointing at a hidden option.
    expect(trigger.hasAttribute('aria-activedescendant')).toBe(false);
  });

  it('lets Escape through when the list is closed', async () => {
    const { fixture, trigger, reachedDocument } = await open();
    key(trigger, 'Escape');
    await fixture.whenStable();
    reachedDocument.mockClear();

    key(trigger, 'Escape');
    expect(reachedDocument).toHaveBeenCalledTimes(1);
  });
});
