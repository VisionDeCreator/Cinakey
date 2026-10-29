import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { RegistrationControls } from "./RegistrationControls";
const configure = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@dirrio/api-client", () => ({ useMutation: () => configure }));
it("requires a reason and explicit confirmation before persisting the toggle", async () => {
  render(<RegistrationControls requireApproval={true} revision={7} />);
  expect(screen.getByRole("switch")).toBeChecked();
  expect(
    screen.getByRole("button", { name: "Review registration change" }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole("switch"));
  fireEvent.change(
    screen.getByLabelText("Setting change reason (10–2000 characters)"),
    { target: { value: "Open registration for launch" } },
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Review registration change" }),
  );
  expect(configure).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog")).toHaveTextContent(
    "including pending and rejected applicants",
  );
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(configure).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Review registration change" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(configure).toHaveBeenCalledWith(
      expect.objectContaining({
        requireApproval: false,
        revision: 7,
        reason: "Open registration for launch",
        requestId: expect.any(String),
      }),
    ),
  );
});
