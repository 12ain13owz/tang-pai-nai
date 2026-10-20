import { deviceLabel } from './device-label'

const UA = {
  androidChrome:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  iphoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1',
  windowsEdge:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
  samsungTablet:
    'Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Safari/537.36',
  macFirefox: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:131.0) Gecko/20100101 Firefox/131.0',
  lineIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.10.0',
}

describe('deviceLabel', () => {
  it.each([
    [UA.androidChrome, 'Chrome · Android', 'phone'],
    [UA.iphoneSafari, 'Safari · iPhone', 'phone'],
    [UA.iphoneChrome, 'Chrome · iPhone', 'phone'],
    [UA.windowsEdge, 'Edge · Windows', 'computer'],
    [UA.samsungTablet, 'Samsung Internet · Android', 'tablet'],
    [UA.macFirefox, 'Firefox · Mac', 'computer'],
    [UA.lineIos, 'LINE · iPhone', 'phone'],
  ])('names %s', (userAgent, name, kind) => {
    expect(deviceLabel(userAgent)).toEqual({ name, kind })
  })

  it('has no name for a missing or unknown user agent', () => {
    expect(deviceLabel(null)).toEqual({ name: null, kind: 'computer' })
    expect(deviceLabel('curl/8.5.0')).toEqual({ name: null, kind: 'computer' })
  })
})
