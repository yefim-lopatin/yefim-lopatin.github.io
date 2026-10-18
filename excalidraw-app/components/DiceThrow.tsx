import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import type { DiceSides } from "./DiceRoller";

export type ThrowResult = { results: number[] };

type Props = {
  sides: DiceSides;
  count: number;
  hunger: number;
  clientX: number;
  clientY: number;
  onComplete: (result: ThrowResult) => void;
};

// Load the renderer only when a throw is requested.
export const DiceThrow = (props: Props) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const completeRef = useRef(props.onComplete);
  completeRef.current = props.onComplete;

  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    Promise.all([import("./dicePhysics")])
      .then(async ([{ animateDice }]) => {
        if (!disposed && canvasRef.current) {
          const release = await animateDice(
            canvasRef.current,
            props,
            (result) => {
              if (!disposed) {
                completeRef.current(result);
              }
            },
          );
          if (disposed) {
            release();
          } else {
            cleanup = release;
          }
        }
      })
      .catch(() => {
        // Keep rolling usable on devices without WebGL.
        if (!disposed) {
          completeRef.current({ results: [] });
        }
      });
    return () => {
      disposed = true;
      cleanup();
    };
    // A new mounted component represents exactly one throw.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return createPortal(
    <canvas
      ref={canvasRef}
      className="dice-roller__physics"
      aria-label="Объёмные кубики бросаются"
      role="img"
    />,
    document.body,
  );
};
