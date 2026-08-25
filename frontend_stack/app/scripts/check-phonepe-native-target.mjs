import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const variantArgument = process.argv.find((value) => value.startsWith('--variant='));
const variant = variantArgument?.split('=')[1];
if (variant !== 'client' && variant !== 'admin') {
  throw new Error('The native target must be client or admin.');
}

const androidRoot = join(process.cwd(), 'android');
const settings = readFileSync(join(androidRoot, 'capacitor.settings.gradle'), 'utf8');
const dependencies = readFileSync(join(androidRoot, 'app', 'capacitor.build.gradle'), 'utf8');
const pluginManifest = readFileSync(join(androidRoot, 'app', 'src', 'main', 'assets', 'capacitor.plugins.json'), 'utf8');
const manifest = JSON.parse(pluginManifest);
const count = (content, value) => content.split(value).length - 1;
const checks = [
  count(settings, "include ':ionic-capacitor-phonepe-pg'") === 1 &&
    count(settings, "project(':ionic-capacitor-phonepe-pg').projectDir = new File('../../node_modules/ionic-capacitor-phonepe-pg/android')") === 1,
  count(dependencies, "implementation project(':ionic-capacitor-phonepe-pg')") === 1,
  manifest.filter((entry) => entry?.pkg === 'ionic-capacitor-phonepe-pg' &&
    entry?.classpath === 'com.phonepe.payment.capacitor.PhonePePaymentSDKPlugin').length === 1,
];
const presence = [
  /phonepe/iu.test(settings),
  /phonepe/iu.test(dependencies),
  manifest.some((entry) => /phonepe/iu.test(`${entry?.pkg || ''}:${entry?.classpath || ''}`)),
];

if (variant === 'client' && checks.some((present) => !present)) {
  throw new Error('Client native target is missing an exact PhonePe entry in a generated file.');
}
if (variant === 'admin' && presence.some(Boolean)) {
  throw new Error('Admin native target contains a PhonePe entry in a generated file.');
}

console.log(`Native plugin target OK: ${variant}`);
