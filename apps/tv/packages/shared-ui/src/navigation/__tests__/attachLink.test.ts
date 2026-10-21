import { parseAttachLink } from '../attachLink';

const id = 'a1'.repeat(16);

describe('parseAttachLink', () => {
  it('parses the Android deep link', () => {
    expect(parseAttachLink(`couchcoach://attach?s=${id}&m=m1&n=Maya`)).toEqual({ sessionId: id, memberId: 'm1', name: 'Maya' });
  });

  it('parses the web preview form and defaults the Member', () => {
    expect(parseAttachLink(`http://localhost:8082/?attach=1&s=${id}`)).toEqual({ sessionId: id, memberId: 'demo', name: 'Demo' });
  });

  it('rejects malformed session ids, other links, and missing params', () => {
    expect(parseAttachLink(`couchcoach://attach?s=nothex`)).toBeNull();
    expect(parseAttachLink(`http://localhost:8082/?s=${id}`)).toBeNull();
    expect(parseAttachLink(`couchcoach://other?s=${id}`)).toBeNull();
    expect(parseAttachLink(null)).toBeNull();
    expect(parseAttachLink('couchcoach://attach')).toBeNull();
  });
});
