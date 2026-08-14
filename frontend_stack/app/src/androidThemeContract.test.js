import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const stylesPath = resolve(process.cwd(), 'app/android/app/src/main/res/values/styles.xml');
const styles = readFileSync(stylesPath, 'utf8');

function themeBlock(name) {
  const start = styles.indexOf(`<style name="${name}"`);
  expect(start, `theme ${name} must exist`).toBeGreaterThan(-1);
  const end = styles.indexOf('</style>', start);
  return styles.slice(start, end);
}

function withoutComments(source) {
  return source.replace(/<!--[\s\S]*?-->/g, '');
}

describe('the android theme contract', () => {
  test('no theme sets android:background', () => {
    const items = [...withoutComments(styles).matchAll(/<item name="android:background">([^<]*)</g)];
    expect(
      items.map((match) => match[1]),
      'android:background in a THEME becomes the default background of every view that does not set '
      + 'its own, including native popup windows. v0.9.1 pointed it at the splash drawable, so the '
      + 'full-screen splash image rendered behind every <select> dropdown, menu and context menu. '
      + 'Use android:windowBackground.',
    ).toEqual([]);
  });

  test('the launch theme paints the splash through windowBackground', () => {
    const launch = withoutComments(themeBlock('AppTheme.NoActionBarLaunch'));
    expect(launch).toContain('<item name="android:windowBackground">@drawable/splash</item>');
  });

  test('the launch theme hands off to the app theme', () => {
    const launch = withoutComments(themeBlock('AppTheme.NoActionBarLaunch'));
    expect(launch).toContain('<item name="postSplashScreenTheme">@style/AppTheme.NoActionBar</item>');
  });

  test('the app theme keeps a matched window background so the handoff shows no flash', () => {
    const app = withoutComments(themeBlock('AppTheme.NoActionBar'));
    expect(app).toContain('<item name="android:windowBackground">@color/launchBackground</item>');
  });

  test('the app theme refuses algorithmic darkening, so brand colours render as designed', () => {
    const app = withoutComments(themeBlock('AppTheme.NoActionBar'));
    expect(app).toContain('<item name="android:forceDarkAllowed">false</item>');
  });
});
