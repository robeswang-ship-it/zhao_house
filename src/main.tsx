import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import PetOverlay from "./PetOverlay";
import "./styles.css";

const isControlPanel = new URLSearchParams(window.location.search).get("mode") === "control";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {isControlPanel ? <App /> : <PetOverlay />}
  </StrictMode>,
);
