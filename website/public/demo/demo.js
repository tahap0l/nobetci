const deny = document.getElementById("deny");
const allow = document.getElementById("allow");
const reset = document.getElementById("reset");
const result = document.getElementById("result");
function showDecision(decision) {
  allow.disabled = deny.disabled = Boolean(decision);
  reset.disabled = !decision;
  result.textContent = decision;
  (decision ? reset : allow).focus();
}
deny.addEventListener("click", () => showDecision("Örnek istek reddedildi."));
allow.addEventListener("click", () => showDecision("Örnek istek onaylandı."));
reset.addEventListener("click", () => showDecision(""));
