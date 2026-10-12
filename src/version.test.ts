import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { APP_VERSION } from './version'

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')

describe('release version', () => {
  // Every manifest must agree on the version: the app shows this string to the user, Gradle
  // derives the Android versionCode from tauri.conf.json, and Cargo names the built library.
  it('matches package.json', () => {
    expect(JSON.parse(read('../package.json')).version).toBe(APP_VERSION)
  })

  it('matches tauri.conf.json', () => {
    expect(JSON.parse(read('../src-tauri/tauri.conf.json')).version).toBe(APP_VERSION)
  })

  it('matches Cargo.toml', () => {
    expect(read('../src-tauri/Cargo.toml').match(/^version = "([^"]+)"/m)?.[1]).toBe(APP_VERSION)
  })
})
