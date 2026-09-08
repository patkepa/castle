import { Button } from "@patkepa/kantzen-ui/primitives";
import { EmptyState } from "@patkepa/kantzen-ui";
import { useNavigate } from "react-router-dom";

export function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <main className="not-found-page">
      <EmptyState
        icon="path-search"
        title="Page not found"
        description="The requested viewer route does not exist."
      />
      <Button
        intent="primary"
        icon="home"
        text="Return to library"
        onClick={() => navigate("/")}
      />
    </main>
  );
}
