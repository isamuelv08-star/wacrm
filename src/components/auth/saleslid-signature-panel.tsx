/**
 * Purely decorative brand panel for the login screen's right half —
 * see the approved design plan (paleta "Saleslid Red" #FF3131 +
 * "Signal/Steel Navy", elemento firma "Franjas de escalamiento").
 *
 * The bars are the SAME diagonal-cut geometry as the real logo mark
 * (public/logo-mark.png — 4 diagonal parallelogram bars),
 * scaled up into an environmental composition rather than a repeated
 * copy of the logo itself. Hard clip-path edges on purpose — the mark
 * has clean geometric cuts, not soft gradients, so the panel should
 * read with the same precision instead of a generic blurred-wallpaper
 * banner.
 *
 * `aria-hidden` — nothing here is interactive or conveys information
 * beyond decoration; the actual account context lives in the form
 * panel next to it.
 */
export function SaleslidSignaturePanel() {
  return (
    <div
      aria-hidden
      className="relative hidden h-full w-full overflow-hidden lg:flex lg:flex-col lg:justify-end"
      style={{ backgroundColor: "#122A4E" /* Signal Navy */ }}
    >
      {/* Diagonal bars — same "/" slant as the logo mark, varied width
          and spacing so it doesn't read as a uniform striped pattern.
          Two Steel Navy bars establish the rhythm; one Saleslid Red bar
          carries the brand color's "similar weight" mandate from the
          design plan — not a minor accent, real occupied space. */}
      <span
        className="absolute inset-y-[-10%] left-[-15%] w-[22%]"
        style={{
          backgroundColor: "#224370" /* Steel Navy */,
          clipPath: "polygon(55% 0%, 85% 0%, 45% 100%, 15% 100%)",
        }}
      />
      <span
        className="absolute inset-y-[-10%] left-[18%] w-[16%]"
        style={{
          backgroundColor: "#FF3131" /* Saleslid Red */,
          clipPath: "polygon(55% 0%, 78% 0%, 40% 100%, 17% 100%)",
        }}
      />
      <span
        className="absolute inset-y-[-10%] left-[46%] w-[26%]"
        style={{
          backgroundColor: "#224370" /* Steel Navy */,
          clipPath: "polygon(55% 0%, 88% 0%, 42% 100%, 9% 100%)",
        }}
      />
      <span
        className="absolute inset-y-[-10%] left-[82%] w-[14%]"
        style={{
          backgroundColor: "#1A3660",
          clipPath: "polygon(55% 0%, 85% 0%, 40% 100%, 10% 100%)",
        }}
      />

      {/* Logo mark + product line, anchored bottom-left over the bars. */}
      <div className="relative z-10 p-10 xl:p-14">
        <img
          src="/logo-mark.png"
          alt=""
          className="h-9 w-9 object-contain"
        />
        <p className="mt-5 max-w-xs font-heading text-2xl leading-snug font-medium text-white xl:text-[28px]">
          Conversaciones que se convierten en ventas.
        </p>
      </div>
    </div>
  );
}
