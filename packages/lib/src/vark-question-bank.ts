export type VarkStyle = "visual" | "auditory" | "readingWriting" | "kinesthetic";

export type VarkOption = {
  id: string;
  text: string;
  style: VarkStyle;
};

export type VarkQuestion = {
  id: string;
  question: string;
  context?: string;
  options: VarkOption[];
};

export type VarkAnswerMap = Record<string, string[]>;

export type VarkScoreResult = {
  visual: number;
  auditory: number;
  readingWriting: number;
  kinesthetic: number;
  primaryStyle: VarkStyle;
  secondaryStyle?: VarkStyle;
  isMultimodal: boolean;
};

export const VARK_STYLE_LABELS: Record<VarkStyle, string> = {
  visual: "Visual",
  auditory: "Auditory",
  readingWriting: "Reading/Writing",
  kinesthetic: "Kinesthetic",
};

export const VARK_STYLE_DESCRIPTIONS: Record<VarkStyle, string> = {
  visual:
    "Learns best from diagrams, film clips, sketches, mat maps, color coding, and seeing positions clearly.",
  auditory:
    "Learns best from coach explanation, verbal cues, discussion, call-and-response, and hearing corrections.",
  readingWriting:
    "Learns best from written notes, checklists, practice plans, journals, terminology, and step-by-step text.",
  kinesthetic:
    "Learns best by drilling, feeling positions, live reps, demonstrations, and hands-on correction.",
};

export const VARK_QUESTION_BANK: VarkQuestion[] = [
  {
    id: "q1",
    question: "Your coach teaches a new takedown. What helps you learn it fastest?",
    options: [
      {
        id: "q1_visual",
        text: "Watching the move broken down with clear angles or film.",
        style: "visual",
      },
      {
        id: "q1_auditory",
        text: "Listening to the coach explain the key details and cues.",
        style: "auditory",
      },
      {
        id: "q1_reading",
        text: "Reading the steps or seeing a written checklist.",
        style: "readingWriting",
      },
      {
        id: "q1_kinesthetic",
        text: "Getting on the mat and drilling it right away.",
        style: "kinesthetic",
      },
    ],
  },
  {
    id: "q2",
    question: "Before a match, what type of reminder helps you most?",
    options: [
      {
        id: "q2_visual",
        text: "A quick visual of my best attacks or match plan.",
        style: "visual",
      },
      {
        id: "q2_auditory",
        text: "Coach telling me one or two simple cues.",
        style: "auditory",
      },
      {
        id: "q2_reading",
        text: "A short written checklist I can read.",
        style: "readingWriting",
      },
      {
        id: "q2_kinesthetic",
        text: "Moving through my stance, motion, hand-fighting, and shots.",
        style: "kinesthetic",
      },
    ],
  },
  {
    id: "q3",
    question: "You keep making the same mistake in practice. What correction sticks best?",
    options: [
      {
        id: "q3_visual",
        text: "Seeing a side-by-side example of wrong versus right.",
        style: "visual",
      },
      {
        id: "q3_auditory",
        text: "Hearing a short phrase I can repeat during the rep.",
        style: "auditory",
      },
      {
        id: "q3_reading",
        text: "Writing the mistake and fix in my notes or journal.",
        style: "readingWriting",
      },
      {
        id: "q3_kinesthetic",
        text: "Having the coach physically guide the correct position.",
        style: "kinesthetic",
      },
    ],
  },
  {
    id: "q4",
    question: "When studying film, what helps you improve the most?",
    options: [
      {
        id: "q4_visual",
        text: "Watching clips and seeing patterns in positions.",
        style: "visual",
      },
      {
        id: "q4_auditory",
        text: "Talking through the match with a coach or teammate.",
        style: "auditory",
      },
      {
        id: "q4_reading",
        text: "Writing down notes, mistakes, and next-match goals.",
        style: "readingWriting",
      },
      {
        id: "q4_kinesthetic",
        text: "Re-creating the position on the mat and drilling the fix.",
        style: "kinesthetic",
      },
    ],
  },
  {
    id: "q5",
    question: "You are learning a new bottom escape. What do you want first?",
    options: [
      {
        id: "q5_visual",
        text: "A clear demonstration from multiple angles.",
        style: "visual",
      },
      {
        id: "q5_auditory",
        text: "A simple verbal cue like hips, hands, head.",
        style: "auditory",
      },
      {
        id: "q5_reading",
        text: "The steps written out in order.",
        style: "readingWriting",
      },
      {
        id: "q5_kinesthetic",
        text: "A partner so I can feel the pressure and try it.",
        style: "kinesthetic",
      },
    ],
  },
  {
    id: "q6",
    question: "During practice, what keeps you locked in?",
    options: [
      {
        id: "q6_visual",
        text: "Seeing the practice flow, timer, or station layout.",
        style: "visual",
      },
      {
        id: "q6_auditory",
        text: "Coach calling out energy, cues, and corrections.",
        style: "auditory",
      },
      {
        id: "q6_reading",
        text: "Knowing the written plan and goals for each block.",
        style: "readingWriting",
      },
      {
        id: "q6_kinesthetic",
        text: "High-rep drilling, movement, and live wrestling.",
        style: "kinesthetic",
      },
    ],
  },
  {
    id: "q7",
    question: "You are trying to remember your best setup. What helps most?",
    options: [
      {
        id: "q7_visual",
        text: "Seeing a picture or clip of the setup.",
        style: "visual",
      },
      {
        id: "q7_auditory",
        text: "Hearing the setup cue from my coach.",
        style: "auditory",
      },
      {
        id: "q7_reading",
        text: "Writing the setup in my match notes.",
        style: "readingWriting",
      },
      {
        id: "q7_kinesthetic",
        text: "Shadow wrestling or drilling the setup repeatedly.",
        style: "kinesthetic",
      },
    ],
  },
  {
    id: "q8",
    question: "If you are nervous before competing, what helps you reset?",
    options: [
      {
        id: "q8_visual",
        text: "Visualizing my first attack and seeing myself score.",
        style: "visual",
      },
      {
        id: "q8_auditory",
        text: "Hearing calm, confident reminders from a coach.",
        style: "auditory",
      },
      {
        id: "q8_reading",
        text: "Reading my goals, routine, or match plan.",
        style: "readingWriting",
      },
      {
        id: "q8_kinesthetic",
        text: "Moving, warming up, hand-fighting, or drilling shots.",
        style: "kinesthetic",
      },
    ],
  },
  {
    id: "q9",
    question: "Your coach gives you homework. Which one would you actually use?",
    options: [
      {
        id: "q9_visual",
        text: "A short video playlist or diagram.",
        style: "visual",
      },
      {
        id: "q9_auditory",
        text: "A voice note or verbal recap.",
        style: "auditory",
      },
      {
        id: "q9_reading",
        text: "A written checklist or journal prompt.",
        style: "readingWriting",
      },
      {
        id: "q9_kinesthetic",
        text: "A movement drill I can physically practice.",
        style: "kinesthetic",
      },
    ],
  },
  {
    id: "q10",
    question: "When learning a chain wrestle sequence, what works best?",
    options: [
      {
        id: "q10_visual",
        text: "Seeing the whole sequence mapped out.",
        style: "visual",
      },
      {
        id: "q10_auditory",
        text: "Hearing the coach call the sequence step by step.",
        style: "auditory",
      },
      {
        id: "q10_reading",
        text: "Reading the sequence as a list.",
        style: "readingWriting",
      },
      {
        id: "q10_kinesthetic",
        text: "Repeating the chain with a partner until it feels natural.",
        style: "kinesthetic",
      },
    ],
  },
  {
    id: "q11",
    question: "After a loss, what helps you improve the fastest?",
    options: [
      {
        id: "q11_visual",
        text: "Watching the key moments where the match changed.",
        style: "visual",
      },
      {
        id: "q11_auditory",
        text: "Talking through what happened with my coach.",
        style: "auditory",
      },
      {
        id: "q11_reading",
        text: "Writing what I learned and what I need to fix.",
        style: "readingWriting",
      },
      {
        id: "q11_kinesthetic",
        text: "Getting back on the mat and drilling the situation.",
        style: "kinesthetic",
      },
    ],
  },
  {
    id: "q12",
    question: "A teammate asks you how you learned a move. You would say:",
    options: [
      {
        id: "q12_visual",
        text: "I saw it clearly and copied the position.",
        style: "visual",
      },
      {
        id: "q12_auditory",
        text: "The coach explained it in a way that clicked.",
        style: "auditory",
      },
      {
        id: "q12_reading",
        text: "The notes or steps helped me remember it.",
        style: "readingWriting",
      },
      {
        id: "q12_kinesthetic",
        text: "I drilled it enough that it started to feel right.",
        style: "kinesthetic",
      },
    ],
  },
];

export function scoreVarkAnswers(answers: VarkAnswerMap): VarkScoreResult {
  const scores: Record<VarkStyle, number> = {
    visual: 0,
    auditory: 0,
    readingWriting: 0,
    kinesthetic: 0,
  };

  for (const question of VARK_QUESTION_BANK) {
    const selectedOptionIds = answers[question.id] || [];

    for (const optionId of selectedOptionIds) {
      const option = question.options.find((item) => item.id === optionId);

      if (option) {
        scores[option.style] += 1;
      }
    }
  }

  const ranked = (Object.keys(scores) as VarkStyle[]).sort(
    (a, b) => scores[b] - scores[a]
  );

  const primaryStyle = ranked[0];
  const secondaryStyle = scores[ranked[1]] > 0 ? ranked[1] : undefined;
  const topScore = scores[primaryStyle];
  const tiedTopCount = ranked.filter((style) => scores[style] === topScore).length;

  return {
    visual: scores.visual,
    auditory: scores.auditory,
    readingWriting: scores.readingWriting,
    kinesthetic: scores.kinesthetic,
    primaryStyle,
    secondaryStyle,
    isMultimodal: tiedTopCount > 1 || (secondaryStyle ? topScore - scores[secondaryStyle] <= 1 : false),
  };
}

export function getVarkCompletionPercent(answers: VarkAnswerMap) {
  const answeredCount = VARK_QUESTION_BANK.filter(
    (question) => (answers[question.id] || []).length > 0
  ).length;

  return Math.round((answeredCount / VARK_QUESTION_BANK.length) * 100);
}