[![Community Project header](https://github.com/newrelic/opensource-website/raw/master/src/images/categories/Community_Project.png)](https://opensource.newrelic.com/oss-category/#community-project)

# New Relic Dash Tracker

New Relic video tracking for Dash Player.

## Requirements

This video monitor solutions works on top of New Relic's **Browser Agent**.

## Build

Install dependencies:

```
$ npm install
```

And build:

```
$ npm run build:dev
```

Or if you need a production build:

```
$ npm run build
```

## Usage

Load **scripts** inside `dist` folder into your page.

```html
<script src="../dist/newrelic-video-hls.min.js"></script>
```

```javascript
options = {
  info: {
    beacon: 'XXXXXXXXXXX',
    licenseKey: 'XXXXXXXXXXXXX',
    applicationID: 'XXXXXXX',
  },
};

const tracker = new DashTracker(player, options);
```

## Release

- Create a PR.
- Once approved, Update the package version according to the semver rules.
- Update the CHANGELOG in the repo (all web repos have a changelog file).
- Create a github tag with the version.
