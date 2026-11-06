"""Topic filter: decides whether a video is about artificial intelligence.

A video matches when its YouTube title, its channel name, or one of the
Hacker News headlines it was submitted under contains an AI term. Terms are
matched on word boundaries so that "AI" never matches "said" or "Haiku".
Hand-reviewed overrides (ALWAYS / NEVER) fix the cases keywords get wrong.
"""
import re

# Case-sensitive: short acronyms that collide with ordinary words in lower case.
_CASED = re.compile(r"(?<![A-Za-z])(?:AI|A\.I\.|AGI|LLMs?|GPT(?:-?\d)?|ChatGPT|NLP|GANs?|RLHF)(?![A-Za-z])")

# Case-insensitive phrases.
_PHRASES = re.compile(r"\b(?:" + "|".join([
    r"artificial intelligence", r"machine learning", r"deep learning",
    r"neural net(?:work)?s?", r"reinforcement learning", r"backprop(?:agation)?",
    r"gradient descent", r"large language models?", r"language models?",
    r"transformer (?:model|architecture|neural)", r"attention is all you need",
    r"self[- ]attention", r"diffusion models?", r"stable diffusion", r"midjourney",
    r"generative adversarial", r"convolutional", r"perceptrons?",
    r"alphago", r"alphazero", r"alphafold", r"alphastar", r"alphacode", r"muzero",
    r"deepmind", r"openai", r"anthropic", r"chatbots?", r"superintelligen(?:ce|t)",
    r"computer vision", r"natural language processing", r"word2vec", r"tensorflow",
    r"pytorch", r"micrograd", r"nanogpt", r"makemore", r"karpathy", r"hinton",
    r"yann lecun", r"lecun", r"bengio", r"sutskever", r"demis hassabis",
    r"ai safety", r"ai alignment", r"alignment problem", r"self[- ]driving",
    r"autonomous (?:car|vehicle|driving)s?", r"robot learning", r"machine intelligence",
    r"thinking machines?", r"intelligent machines?", r"expert systems?",
    r"eliza", r"turing test", r"chinese room",
]) + r")\b", re.I)

# Channels whose whole output is about AI.
AI_CHANNELS = {
    "andrej karpathy", "two minute papers", "yannic kilcher", "google deepmind",
    "deepmind", "openai", "anthropic", "robert miles ai safety", "lex clips",
    "stanford online", "welch labs", "sentdex",
}
# Channels kept only when the title also matches (they publish mixed content).
MIXED_CHANNELS = {"stanford online", "lex clips", "welch labs", "sentdex"}

# Hand-reviewed overrides by YouTube id (reviewed against the full candidate list).
# ALWAYS: clearly about AI, but no keyword in the title or HN headlines.
ALWAYS = {
    "7Pq-S557XQU",  # CGP Grey, Humans Need Not Apply (automation and AI)
    "WSKi8HfcxEk",  # Kurzgesagt, The Rise of the Machines
    "HwF229U2ba8",  # Deep Blue documentary
    "zihTWh5i2C4",  # Ray Kurzweil, How to Create a Mind
    "X4Neivqp2K4",  # Ray Kurzweil at 17 with a music-composing computer (1965)
    "Nu-nlQqFCKg",  # Microsoft Research deep-network speech recognition (2012)
    "gy5g33S0Gzo",  # Berkeley robot learning to fold unseen towels
    "w-CGSQAO5-Q",  # Toyota Research, teaching robots new behaviours
    "pMYYx_im5QI",  # Daniel Suarez, autonomous weapons (TED)
    "7PKx3kS7f4A",  # Computerphile, Asimov's laws and AI safety
    "yRdzIs4FJJg",  # Tesla Autopilot and motorcycles
    "VVJSjeHDvfY",  # Tesla Autopilot failure at a fatal-crash site
    "9X-5fKzmy38",  # Tesla Autopilot avoids a collision
    "X3hrKnv0dPQ",  # Tesla on Autopilot hits an overturned truck
    "FZ6lZJWL_Xk",  # Tesla unveils Autopilot (2014)
}
# NEVER: matched a keyword only incidentally (an HN headline joke, a podcast's
# old "Artificial Intelligence Podcast" title, an upscaled video, a product name).
NEVER = {
    "dQw4w9WgXcQ",  # Rick Astley
    "Nb2tebYAaOA",  # Jim Keller on microprocessors
    "c01BlUDIlK4",  # Jim Keller, Moore's law clip
    "o4-YnLpLgtk",  # Symbolics Lisp Machine demo
    "4Q7FTjhvZ7Y",  # Project Code Rush (Netscape)
    "040ejWnFkj0",  # Not Just Bikes, urbanism
    "7jiPeIFXb6U",  # Joel Grus, I don't like notebooks
    "ycPr5-27vSI",  # Joe Rogan with Elon Musk
    "udlMSe5-zP8",  # Joe Rogan with John Carmack
    "wsixsRI-Sz4",  # Elon Musk at Code Conference
    "O9upVbGSBFo",  # Lex Fridman with Brian Kernighan
    "2BdBfsXbST8",  # Lex Fridman with Donald Knuth
    "uTxRF5ag27A",  # Lex Fridman with Bjarne Stroustrup
    "ghwaIiE3Nd8",  # Lex Fridman with Guido van Rossum
    "oFtjKbXKqbg",  # Lex Fridman with Pieter Levels
    "LSZPNwZex9s",  # Google's self-driving bicycle (April Fools)
    "2qLuerYx2IA",  # Steve Jobs in Sweden, 1985
    "IiuVggWNqSA",  # Scott Forstall at CHM
    "H-yuZ2pejGU",  # Casio AI-1000 pocket computer
    "SNQtQWjX-sA",  # Sony Trinitron teardown, AI-upscaled
}


def text_matches(text):
    return bool(text) and bool(_CASED.search(text) or _PHRASES.search(text))


def matched_terms(text):
    out = set()
    if not text:
        return out
    out.update(m.group(0) for m in _CASED.finditer(text))
    out.update(m.group(0).lower() for m in _PHRASES.finditer(text))
    return out


def is_ai(video):
    """video: dict with id, title, channel, submissions[{title}]."""
    vid = video["id"]
    if vid in NEVER:
        return False
    if vid in ALWAYS:
        return True
    channel = (video.get("channel") or "").strip().lower()
    texts = [video.get("title") or ""] + [s.get("title") or "" for s in video.get("submissions", [])]
    if any(text_matches(t) for t in texts):
        return True
    return channel in AI_CHANNELS and channel not in MIXED_CHANNELS
