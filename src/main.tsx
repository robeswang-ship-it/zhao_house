import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import PetOverlay from "./PetOverlay";
import "./styles.css";

document.documentElement.classList.add("pet-page");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PetOverlay />
  </StrictMode>,
);
