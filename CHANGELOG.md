# Changelog

## [1.10.0](https://github.com/nicocapalbo/dmbdb/compare/v1.9.0...v1.10.0) (2025-05-04)


### ✨ Features

* dynamic display of services in Settings page ([6d8e119](https://github.com/nicocapalbo/dmbdb/commit/6d8e11948ab02ef60dbba8852d06cf5d2505f291))
* homepage rework ([e5dc755](https://github.com/nicocapalbo/dmbdb/commit/e5dc75571c487d39ddd9abf0d77f6e1820e77c7e))

## [1.9.0](https://github.com/nicocapalbo/dmbdb/compare/v1.8.1...v1.9.0) (2025-04-29)


### ✨ Features

* scrollToBottom button for serviceID logs ([0cb6317](https://github.com/nicocapalbo/dmbdb/commit/0cb6317c0e07aff096a22deea15087f64d9d69e9))


### 🐛 Bug Fixes

* download RTL logs function ([669123a](https://github.com/nicocapalbo/dmbdb/commit/669123a21086eb7ed947c49f610d0925fe9c225b))

## [1.8.1](https://github.com/nicocapalbo/dmbdb/compare/v1.8.0...v1.8.1) (2025-04-14)


### 🐛 Bug Fixes

* SelectComponent.vue style fix ([3033228](https://github.com/nicocapalbo/dmbdb/commit/303322829e6848ee0482c081ea632b51609405da))
* SelectComponent.vue style fix ([eedbffe](https://github.com/nicocapalbo/dmbdb/commit/eedbffed3e35cea2f5621e22c8862e31b5af6d6a))

## [1.8.0](https://github.com/nicocapalbo/dmbdb/compare/v1.7.2...v1.8.0) (2025-04-14)


### ✨ Features

* added versions to processes in settings page ([b701b71](https://github.com/nicocapalbo/dmbdb/commit/b701b717f1de47785240bbe16c2f529b18343570))
* code cleanup, move endpoint call ([209896a](https://github.com/nicocapalbo/dmbdb/commit/209896a5cb8796c9ae18ae5dc58642fecca0d86b))
* enhance Discord announcement with role mention ([9c35d6a](https://github.com/nicocapalbo/dmbdb/commit/9c35d6a6f2db0fca35faf584711f85f656b15236))
* install pinia ([0994f10](https://github.com/nicocapalbo/dmbdb/commit/0994f10948ea18bd331279c6244f97eb504e46b4))
* move processGetter ([4990b57](https://github.com/nicocapalbo/dmbdb/commit/4990b57be5f30be8aa7f5262ed3ca26d414f4b49))
* new components, code deduplication and cleanup; refactors WIP ([b728c2e](https://github.com/nicocapalbo/dmbdb/commit/b728c2e372870c18d8b2c15463544f0dbb9ee45b))
* process Store ([3f17251](https://github.com/nicocapalbo/dmbdb/commit/3f172514ec306a6877b0598bb7e08207a00338dc))
* RTL rework - filters + scrollToBottom btn ([7cb0b1a](https://github.com/nicocapalbo/dmbdb/commit/7cb0b1a833bd2b74702e16d87f096e36c4206ddb))
* RTL rework - filters + scrollToBottom btn ([42ff296](https://github.com/nicocapalbo/dmbdb/commit/42ff296232f0c92a930ddd8d6211e7c26b909789))
* RTL rework - log table ([95ac44c](https://github.com/nicocapalbo/dmbdb/commit/95ac44c3bb4561c707b9b187a427171e9abcda5e))
* RTL rework - WIP + log-parse helper ([38c2537](https://github.com/nicocapalbo/dmbdb/commit/38c2537170fcdd6c8f7a71e3957989a197383d59))
* services refactor; useService + services repositories ([abd2074](https://github.com/nicocapalbo/dmbdb/commit/abd2074d799909026c437932ad3b33c3bb9659eb))
* settings page + tweaks ([3141d25](https://github.com/nicocapalbo/dmbdb/commit/3141d250af8cab923df622c8aac5d92b983021c5))


### 🐛 Bug Fixes

* correct fetchProcess API call and remove temporary workaround ([d9fe679](https://github.com/nicocapalbo/dmbdb/commit/d9fe679b2a499bdce7a8754491616ef5d76975d1))


### 🤡 Other Changes

* code cleanup ([62fa622](https://github.com/nicocapalbo/dmbdb/commit/62fa62285f7716c7a2b082c63fdfa420ed4b674b))
* fix .env load ([75f7cd5](https://github.com/nicocapalbo/dmbdb/commit/75f7cd514ceb8db695876e55b3b5382750c15b86))
* re-install @pinia/nuxt ([afdf349](https://github.com/nicocapalbo/dmbdb/commit/afdf349c1b041743aba7c9058e57c549ce0951c1))
* refactor /processId page ([8d1b3d1](https://github.com/nicocapalbo/dmbdb/commit/8d1b3d1afad1e540a95edbb25acc0481cdeb204c))


### 🎨 Styles

* SideBar component WIP ([f2bba30](https://github.com/nicocapalbo/dmbdb/commit/f2bba30330ed066339eab7d57e5935b1d0214e88))

## [1.7.2](https://github.com/nicocapalbo/dmbdb/compare/v1.7.1...v1.7.2) (2025-03-19)


### 🤡 Other Changes

* add GitHub Actions workflow to announce releases on Discord ([f5bd5ef](https://github.com/nicocapalbo/dmbdb/commit/f5bd5eff8b4dacab452c7aacad2f4f907bc9b4a5))

## [1.7.1](https://github.com/nicocapalbo/dmbdb/compare/v1.7.0...v1.7.1) (2025-03-19)


### 🐛 Bug Fixes

* use environment variable for DMB_API_URL in proxy middleware ([9422d1c](https://github.com/nicocapalbo/dmbdb/commit/9422d1c4f7de4967dc6adb9b5958a7240ae9178d))

## [1.7.0](https://github.com/nicocapalbo/dmbdb/compare/v1.6.2...v1.7.0) (2025-03-18)


### ✨ Features

* add service logs functionality with filtering and download options ([3679286](https://github.com/nicocapalbo/dmbdb/commit/3679286cff1602883b05c78a8e1d051a3e6f8003))


### 🤡 Other Changes

* update dependencies and disable telemetry ([2af1143](https://github.com/nicocapalbo/dmbdb/commit/2af1143f2f6d06b14e7861b76b7677922fd2bd05))

## [1.6.2](https://github.com/nicocapalbo/dmbdb/compare/v1.6.1...v1.6.2) (2025-03-15)


### 🐛 Bug Fixes

* selectComponent ([b4a895c](https://github.com/nicocapalbo/dmbdb/commit/b4a895c0aeadbb80208b2691fdccde6fc65e7129))
* selectComponent ([6a39312](https://github.com/nicocapalbo/dmbdb/commit/6a39312516f23bcf90a1007aa30944a0147cb5a9))

## [1.6.1](https://github.com/nicocapalbo/dmbdb/compare/v1.6.0...v1.6.1) (2025-03-15)


### 🐛 Bug Fixes

* selectComponent - mobile view ([#18](https://github.com/nicocapalbo/dmbdb/issues/18)) ([6e7ac3f](https://github.com/nicocapalbo/dmbdb/commit/6e7ac3fcea6ee1b5728c9667f21a345c672ce665))

## [1.6.0](https://github.com/nicocapalbo/dmbdb/compare/v1.5.1...v1.6.0) (2025-03-14)


### ✨ Features

* tailwind colors trial ([2699671](https://github.com/nicocapalbo/dmbdb/commit/2699671f2dbd6d163c3b3f6215fc7597ec3e33bc))


### 🛠️ Refactors

* minor modifications ([799a5cf](https://github.com/nicocapalbo/dmbdb/commit/799a5cfcdf5b8c0871c4d51ec59e1e80abf10b78))
* realTimeLogs page refactor + css cleanup + minor style changes ([c8c8876](https://github.com/nicocapalbo/dmbdb/commit/c8c88763b73463a7a43e7fe235a59935b71bf09c))
* realTimeLogs page refactor + css cleanup + minor style changes ([e883b6a](https://github.com/nicocapalbo/dmbdb/commit/e883b6a93387659ddcef9d9b66078ed7cae92620))

## [1.5.1](https://github.com/nicocapalbo/dmbdb/compare/v1.5.0...v1.5.1) (2025-03-14)


### 🐛 Bug Fixes

* **websocket:** prevent redefinition of $socket and improve connection handling ([49793da](https://github.com/nicocapalbo/dmbdb/commit/49793daa9ba092f3c5ea28f72da4525ca1abc215))

## [1.5.0](https://github.com/nicocapalbo/dmbdb/compare/v1.4.0...v1.5.0) (2025-03-07)


### ✨ Features

* **rtl:** update log name ([8b6a14f](https://github.com/nicocapalbo/dmbdb/commit/8b6a14fdabaa7be9f34aa0bc42e31a1a02866e87))
* secrets.RELEASE_PLEASE_TOKEN ([cc95346](https://github.com/nicocapalbo/dmbdb/commit/cc95346d66e23d9f8c67d363b22b3202472f3965))


### 🐛 Bug Fixes

* **release-please-config:** set include-component-in-tag false ([fda8232](https://github.com/nicocapalbo/dmbdb/commit/fda8232dac2951da87aa891d8835473eb6a80e53))


### 🤡 Other Changes

* **main:** release dmbdb 1.2.2 ([#13](https://github.com/nicocapalbo/dmbdb/issues/13)) ([#6](https://github.com/nicocapalbo/dmbdb/issues/6)) ([50bdef9](https://github.com/nicocapalbo/dmbdb/commit/50bdef910211645fbfe61055464ba03505762d00))
* **main:** release dmbdb 1.2.3 ([#14](https://github.com/nicocapalbo/dmbdb/issues/14)) ([#7](https://github.com/nicocapalbo/dmbdb/issues/7)) ([c11962b](https://github.com/nicocapalbo/dmbdb/commit/c11962b428729118f281d4da9bd7608d1cb228f5))
* **main:** release dmbdb 1.3.0 ([3f106f1](https://github.com/nicocapalbo/dmbdb/commit/3f106f1df687924dd928bf3603b05a934b496cc1))
* **main:** release dmbdb 1.4.0 ([4003988](https://github.com/nicocapalbo/dmbdb/commit/4003988bbbd55b979c019acb3c636f34aa0cad33))
* **main:** release dmbdb 1.4.0 ([#9](https://github.com/nicocapalbo/dmbdb/issues/9)) ([eaa62bf](https://github.com/nicocapalbo/dmbdb/commit/eaa62bf1765788b327f1e6c0bea47de7577028b3))
* **main:** release dmbdb 1.4.0 ([#9](https://github.com/nicocapalbo/dmbdb/issues/9)) ([#10](https://github.com/nicocapalbo/dmbdb/issues/10)) ([50f49d9](https://github.com/nicocapalbo/dmbdb/commit/50f49d960f037be498d748530e0c5c3501829b63))

## [1.4.0](https://github.com/nicocapalbo/dmbdb/compare/dmbdb-v1.3.0...dmbdb-v1.4.0) (2025-03-06)


### ✨ Features

* **rtl:** update log name ([8b6a14f](https://github.com/nicocapalbo/dmbdb/commit/8b6a14fdabaa7be9f34aa0bc42e31a1a02866e87))


### 🤡 Other Changes

* **main:** release dmbdb 1.2.2 ([#13](https://github.com/nicocapalbo/dmbdb/issues/13)) ([#6](https://github.com/nicocapalbo/dmbdb/issues/6)) ([50bdef9](https://github.com/nicocapalbo/dmbdb/commit/50bdef910211645fbfe61055464ba03505762d00))
* **main:** release dmbdb 1.2.3 ([#14](https://github.com/nicocapalbo/dmbdb/issues/14)) ([#7](https://github.com/nicocapalbo/dmbdb/issues/7)) ([c11962b](https://github.com/nicocapalbo/dmbdb/commit/c11962b428729118f281d4da9bd7608d1cb228f5))

## [1.3.0](https://github.com/nicocapalbo/dmbdb/compare/dmbdb-v1.2.3...dmbdb-v1.3.0) (2025-02-28)


### ✨ Features

* **rtl:** update log name ([8b6a14f](https://github.com/nicocapalbo/dmbdb/commit/8b6a14fdabaa7be9f34aa0bc42e31a1a02866e87))


### 🤡 Other Changes

* **main:** release dmbdb 1.2.2 ([#13](https://github.com/nicocapalbo/dmbdb/issues/13)) ([#6](https://github.com/nicocapalbo/dmbdb/issues/6)) ([50bdef9](https://github.com/nicocapalbo/dmbdb/commit/50bdef910211645fbfe61055464ba03505762d00))
* **main:** release dmbdb 1.2.3 ([#14](https://github.com/nicocapalbo/dmbdb/issues/14)) ([#7](https://github.com/nicocapalbo/dmbdb/issues/7)) ([c11962b](https://github.com/nicocapalbo/dmbdb/commit/c11962b428729118f281d4da9bd7608d1cb228f5))

## [1.2.3](https://github.com/I-am-PUID-0/dmbdb/compare/dmbdb-v1.2.2...dmbdb-v1.2.3) (2025-02-28)


### 🛠️ Refactors

* **pnpm:** update lockfile, pin pnpm version, add postCreateCommand ([d569954](https://github.com/I-am-PUID-0/dmbdb/commit/d56995405cf8f126e2937ecdd065fbc6e87be531))

## [1.2.2](https://github.com/I-am-PUID-0/dmbdb/compare/dmbdb-v1.2.1...dmbdb-v1.2.2) (2025-02-28)


### 🚀 CI/CD Pipeline

* **workflow:** add GitHub Actions workflow for conventional commits ([1986fab](https://github.com/I-am-PUID-0/dmbdb/commit/1986fabe6e2e9f6df6bfaeff47014af3abff8d4d))

## [1.2.1](https://github.com/I-am-PUID-0/dmbdb/compare/dmbdb-v1.2.0...dmbdb-v1.2.1) (2025-02-28)


### 🐛 Bug Fixes

* **proxy:** resolve WebSocket proxy crash due to undefined 'on' property ([b6f41c6](https://github.com/I-am-PUID-0/dmbdb/commit/b6f41c63824fc818426d270fe340bc61b83555b9))

## [1.2.0](https://github.com/I-am-PUID-0/dmbdb/compare/dmbdb-v1.1.0...dmbdb-v1.2.0) (2025-02-28)


### ✨ Features

* **rtl:** update log name ([8b6a14f](https://github.com/I-am-PUID-0/dmbdb/commit/8b6a14fdabaa7be9f34aa0bc42e31a1a02866e87))


### 🐛 Bug Fixes

* **proxy:** MaxListenersExceededWarning, adds uiServiceProxy ([ea89d00](https://github.com/I-am-PUID-0/dmbdb/commit/ea89d00510ee57783863f9535eda0edbb223a5a1))


### 🤡 Other Changes

* **deps:** consolidate dependency updates ([d8f6287](https://github.com/I-am-PUID-0/dmbdb/commit/d8f62871ec261d3580196d28cd04b35977d4ff6c))


### 🚀 CI/CD Pipeline

* **devcontainer:** add devcontainer & dependabot ([803e636](https://github.com/I-am-PUID-0/dmbdb/commit/803e636f7dc0667473b90370a76e0f6366c0fca0))
* **release-please:** add release-please workflow ([f81af57](https://github.com/I-am-PUID-0/dmbdb/commit/f81af57c54c0174c03114c84ab4ffbe56a89da83))
* **release-please:** add workflow_dispatch ([bda2030](https://github.com/I-am-PUID-0/dmbdb/commit/bda2030d4e6849296c20bb87b785bb8a3e21fb76))


### 🛠️ Refactors

* **dependabot:** add github-actions & npm checks ([#1](https://github.com/I-am-PUID-0/dmbdb/issues/1)) ([3aff0e4](https://github.com/I-am-PUID-0/dmbdb/commit/3aff0e4e3234e3e71ad16a71a705b71da17da636))
* **release-please:** add config and manifest ([63f978b](https://github.com/I-am-PUID-0/dmbdb/commit/63f978b76c7d17fdb448e0174f862ce127040f34))
* **release-please:** re-add manifest, change to release-type: simple ([da1e0e0](https://github.com/I-am-PUID-0/dmbdb/commit/da1e0e0dcf40eb159a4215ced7879df33a88c9fd))
* **release-please:** remove manifest ([6e0bc27](https://github.com/I-am-PUID-0/dmbdb/commit/6e0bc27cd27eb49a9ff14867ba3e0d68832e887d))
* **release-please:** remove release-type ([980dc78](https://github.com/I-am-PUID-0/dmbdb/commit/980dc7861488bc1fcff30a34ce094d289f4cfaa4))
