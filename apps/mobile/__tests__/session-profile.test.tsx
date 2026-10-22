import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import i18n from '../src/i18n';
import { SessionProfile } from '../src/components/ui/session-profile';

async function render(element: React.JSX.Element): Promise<ReactTestRenderer.ReactTestRenderer> {
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(element);
  });
  return renderer!;
}

const samples = [
  { localSessionId: 'profile-1', timestamp: 100, depthMeters: 0, waterTemperatureCelsius: 24 },
  { localSessionId: 'profile-1', timestamp: 160, depthMeters: 12.4, waterTemperatureCelsius: 22 },
  { localSessionId: 'profile-1', timestamp: 220, depthMeters: 3, waterTemperatureCelsius: 23 },
];

describe('session profile', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('ko');
  });

  test('summarizes the depth profile for VoiceOver and draws with the theme color', async () => {
    const renderer = await render(<SessionProfile testID="profile" samples={samples} kind="depth" title="수심 그래프" />);
    const [container] = renderer.root.findAll(
      node => node.props.testID === 'profile' && typeof node.props.accessibilityLabel === 'string',
    );
    const strokes = renderer.root
      .findAll(node => typeof node.props.stroke === 'string')
      .map(node => node.props.stroke as string);

    // VoiceOver hears the depth, not how many sensor readings were taken.
    expect(container?.props.accessibilityLabel).toBe('수심 그래프. 최대 수심 12.40 m');
    expect(strokes.length).toBeGreaterThan(0);
    expect(strokes).not.toContain('#0ea5e9');
  });

  test('shows a localized empty state when no samples exist', async () => {
    const renderer = await render(<SessionProfile testID="profile" samples={[]} kind="depth" title="수심 그래프" />);

    expect(renderer.root.findAll(node => node.props.children === '측정값 없음').length).toBeGreaterThan(0);
  });
});
