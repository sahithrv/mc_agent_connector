import { fireEvent, render, screen } from "@testing-library/react";

import { useStudioShortcuts } from "./studioShortcuts";

function ShortcutHarness(props: { onPauseAll: () => void; onMarkClip: () => void }): JSX.Element {
  useStudioShortcuts({
    onPauseAll: props.onPauseAll,
    onMarkClip: props.onMarkClip,
  });

  return <input aria-label="typing target" />;
}

describe("studio shortcuts", () => {
  it("runs shortcuts outside inputs and ignores typing targets", () => {
    const onPauseAll = vi.fn();
    const onMarkClip = vi.fn();
    render(<ShortcutHarness onMarkClip={onMarkClip} onPauseAll={onPauseAll} />);

    fireEvent.keyDown(window, { altKey: true, key: "p", shiftKey: true });
    expect(onPauseAll).toHaveBeenCalledTimes(1);

    const input = screen.getByLabelText("typing target");
    fireEvent.keyDown(input, { altKey: true, key: "p", shiftKey: true });
    expect(onPauseAll).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { altKey: true, key: "m", shiftKey: true });
    expect(onMarkClip).toHaveBeenCalledTimes(1);
  });
});
