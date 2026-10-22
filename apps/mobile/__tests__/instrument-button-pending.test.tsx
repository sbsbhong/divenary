import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { InstrumentButton } from '../src/components/ui/instrument';

describe('InstrumentButton pending', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('is busy and disabled at once, keeps its label, and shows a spinner only after 1 s', async () => {
    const onPress = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <InstrumentButton testID="save" label="Save" variant="primary" pending onPress={onPress} />,
      );
    });
    const root = renderer!.root;
    const button = root.findAll(node => node.props.testID === 'save' && node.props.accessibilityState !== undefined)[0]!;

    expect(button.props.accessibilityState).toMatchObject({ busy: true, disabled: true });
    expect(root.findAllByProps({ testID: 'save-spinner' })).toHaveLength(0);
    expect(root.findAll(node => node.props.children === 'Save').length).toBeGreaterThan(0);

    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(999);
    });
    expect(root.findAllByProps({ testID: 'save-spinner' })).toHaveLength(0);

    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(root.findAllByProps({ testID: 'save-spinner' }).length).toBeGreaterThan(0);
    expect(root.findAll(node => node.props.children === 'Save').length).toBeGreaterThan(0);
  });

  it('is an ordinary button when not pending', async () => {
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<InstrumentButton testID="save" label="Save" onPress={jest.fn()} />);
    });
    const button = renderer!.root.findAll(
      node => node.props.testID === 'save' && node.props.accessibilityState !== undefined,
    )[0]!;

    expect(button.props.accessibilityState).toMatchObject({ busy: false, disabled: false });
  });
});
