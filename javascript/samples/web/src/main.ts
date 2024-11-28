// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { Player } from "./player.ts";
import { Recorder } from "./recorder.ts";
import "./style.css";
import { LowLevelRTClient, SessionUpdateMessage, Voice } from "rt-client";
import markdown from '@wcj/markdown-to-html';
import * as fs from 'fs';

let realtimeStreaming: LowLevelRTClient;
let audioRecorder: Recorder;
let audioPlayer: Player;
let feedbackready: boolean = false;
async function start_realtime(endpoint: string, apiKey: string, deploymentOrModel: string) {
  if (isAzureOpenAI()) {
    realtimeStreaming = new LowLevelRTClient(new URL(endpoint), { key: apiKey }, { deployment: deploymentOrModel });
  } else {
    realtimeStreaming = new LowLevelRTClient({ key: apiKey }, { model: deploymentOrModel });
  }

  try {
    console.log("sending session config");
    await realtimeStreaming.send(createConfigMessage("Act as an interviewer named Shambhavi conducting a job interview for a fresher SDE position at Unstop, focusing on technical skills in Angular, Laravel, and Python, as well as communication and problem-solving abilities.\n\n# Steps\n\n1. **Introduction:**\n   - Introduce yourself as Shambhavi, explaining the purpose of the interview.\n   - Provide a brief overview of the Software Development Engineer (SDE) role at Unstop and its significance.\n\n2. **Experience and Background:**\n   - Inquire about the candidate’s educational background and qualifications.\n   - Ask about any past experiences or internships related to software development roles.\n   - Explore proficiency in Angular, Laravel, and Python and ask the candidate to rate themselves on the basis of score out of 10\n\n3. **Technical Skills:**\n   - Pose 3 objective multiple-choice questions related to software development role. Ensure the questions are designed to assess the candidate's technical knowledge and logical thinking.\nFor each question:After the candidate selects an answer, ask them to explain why they believe their choice is correct.\nIf the candidate does not provide an explanation or provides an incomplete answer, prompt them again to clarify their reasoning by saying, e.g., \"Can you elaborate on why you think this is the correct answer?\"\n   - Present subjective, scenario-based questions reflecting real-world contexts.\n   - Discuss any experience in developing scalable software solutions.\n\n4. **Problem-Solving and Decision-Making:**\n   - Present situational questions that evaluate problem-solving skills.\n   - Ask about challenging experiences in software development and the strategies used for solving them.\n\n5. **Leadership and Team Management:**\n   - If applicable, discuss any leadership roles or team management experience.\n   - Inquire about management style and any team-leading experiences, if relevant.\n\n6. **Cultural Fit and Company Values:**\n   - Ask questions to gauge alignment with Unstop’s culture and values.\n   - Explore the candidate’s understanding of Unstop’s business model and potential challenges.\n\n7. **Closing:**\n   - Invite any questions the candidate may have about the role or company.\n   - Provide information on the next steps in the hiring process.\n\n# Interview Segments\n\n1. **Objective-Type Questions:**\n   - Use multiple-choice questions to assess technical knowledge.\n   - Format: \"Question text? [A] Option 1 [B] Option 2 [C] Option 3 [D] Option 4\"\n   - Ask the candidate to explain their choice of answer and if the candidate doesn’t give the explanation so ask again to give the explanation why the chosen answer is correct. Explain the logic behind the same\n\n2. **Subjective Questions:**\n   - Challenge candidates with theoretical and practical knowledge evaluations through open-ended questions.\n   - Focus on technical terms relevant to the role and real-life scenarios ranging from easy to complex.\n\n3. **Role-Based Scenario Question:**\n   - Present scenarios to evaluate problem-solving, communication, and interpersonal skills.\n\n4. **Behavioral Assessment:**\n   - Understand demeanor, attitude, and performance under pressure through behavioral questions.\n   - Observe the candidate’s composure and confidence during the interview.\n\n# Output Format\n\n- **Objective Questions**: Present each question with answer options as described.\n- **Subjective and Scenario Questions**: Use open-ended questions with context and clear expectations for answers.\n- **Behavioral Questions**: Design prompts for detailed and candid responses.\n\n# Examples\n\n**Objective-Type Example**\n- \"Which of the following is NOT a feature of Angular?\"\n  - [A] Directives\n  - [B] MVC Architecture\n  - [C] Dependency Injection\n  - [D] Middleware Integration\n\n**Subjective Example**\n- \"Explain how you would implement a RESTful API in Laravel for a simple e-commerce platform. Describe your approach from design to execution.\"\n\n**Role-Based Scenario Example**\n- \"Imagine you’re tasked with deploying an urgent software update resolving a critical bug affecting multiple live applications. How would you prioritize tasks and communicate with stakeholders to ensure minimal disruption?\"\n\n**Behavioral Example**\n- \"Describe a time when you felt overwhelmed at work. How did you handle the situation, and what was the outcome?\"\n\n# Notes\n\n- Ensure question types effectively evaluate the required skills.\n- Tailor scenarios to align with Unstop’s business model.\n- Observe candidate reactions to stress-inducing questions to assess emotional resilience and problem-solving under pressure.\n\n\n\""));
  } catch (error) {
    console.log(error);
    makeNewTextBlock("[Connection error]: Unable to send initial config message. Please check your endpoint and authentication details.");
    setFormInputState(InputState.ReadyToStart);
    return;
  }
  console.log("sent");
  await Promise.all([resetAudio(true), handleRealtimeMessages()]);
}

function createConfigMessage(instruction: string) : SessionUpdateMessage {

  let configMessage : SessionUpdateMessage = {
    type: "session.update",
    session: {
      "voice": "echo",
      "instructions": instruction,
      "input_audio_format": "pcm16",
      "input_audio_transcription": {
        "model": "whisper-1"
      },
      "turn_detection": {
        "threshold": 0.5,
        "silence_duration_ms": 1600,
        "type": "server_vad"
      },
    }
  };

  const systemMessage = instruction
  const temperature = getTemperature();
  const voice = getVoice();

  if (systemMessage) {
    configMessage.session.instructions = systemMessage;
  }
  if (!isNaN(temperature)) {
    configMessage.session.temperature = temperature;
  }
  if (voice) {
    configMessage.session.voice = voice;
  }

  return configMessage;
}

async function handleRealtimeMessages() {
  for await (const message of realtimeStreaming.messages()) {
    let consoleLog = "" + message.type;

    switch (message.type) {
      case "session.created":
        setFormInputState(InputState.ReadyToStop);
        makeNewTextBlock("<< Session Started >>");
        makeNewTextBlock();
        break;
      case "response.audio_transcript.delta":
        appendToTextBlock(message.delta);
        break;
      case "response.audio.delta":
        const binary = atob(message.delta);
        const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
        const pcmData = new Int16Array(bytes.buffer);
        audioPlayer.play(pcmData);
        break;

      case "input_audio_buffer.speech_started":
        makeNewTextBlock("<< Speech Started >>");
        let textElements = formReceivedTextContainer.children;
        latestInputSpeechBlock = textElements[textElements.length - 1];
        makeNewTextBlock();
        audioPlayer.clear();
        break;
      case "conversation.item.input_audio_transcription.completed":
        const markdownContent=message.transcript;
        latestInputSpeechBlock.textContent += " User: " + markdownContent;
        if (feedbackready) {
          const htmlContent = markdown(markdownContent);
          console.log(htmlContent);
        }
        break;
      case "response.done":
        formReceivedTextContainer.appendChild(document.createElement("hr"));
        break;
      default:
        consoleLog = JSON.stringify(message, null, 2);
        break
    }
    if (consoleLog) {
      console.log(consoleLog);
    }
  }
  resetAudio(false);
}

/**
 * Basic audio handling
 */

let recordingActive: boolean = false;
let buffer: Uint8Array = new Uint8Array();

function combineArray(newData: Uint8Array) {
  const newBuffer = new Uint8Array(buffer.length + newData.length);
  newBuffer.set(buffer);
  newBuffer.set(newData, buffer.length);
  buffer = newBuffer;
}

function processAudioRecordingBuffer(data: Buffer) {
  const uint8Array = new Uint8Array(data);
  combineArray(uint8Array);
  if (buffer.length >= 4800) {
    const toSend = new Uint8Array(buffer.slice(0, 4800));
    buffer = new Uint8Array(buffer.slice(4800));
    const regularArray = String.fromCharCode(...toSend);
    const base64 = btoa(regularArray);
    if (recordingActive) {
      realtimeStreaming.send({
        type: "input_audio_buffer.append",
        audio: base64,
      });
    }
  }

}

async function resetAudio(startRecording: boolean) {
  recordingActive = false;
  if (audioRecorder) {
    audioRecorder.stop();
  }
  if (audioPlayer) {
    audioPlayer.clear();
  }
  audioRecorder = new Recorder(processAudioRecordingBuffer);
  audioPlayer = new Player();
  audioPlayer.init(24000);
  if (startRecording) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioRecorder.start(stream);
    recordingActive = true;
  }
}

/**
 * UI and controls
 */

const formReceivedTextContainer = document.querySelector<HTMLDivElement>(
  "#received-text-container",
)!;
const formStartButton =
  document.querySelector<HTMLButtonElement>("#start-recording")!;
const formStopButton =
  document.querySelector<HTMLButtonElement>("#stop-recording")!;
const formClearAllButton =
  document.querySelector<HTMLButtonElement>("#clear-all")!;
const formEndpointField =
  document.querySelector<HTMLInputElement>("#endpoint")!;
const formAzureToggle =
  document.querySelector<HTMLInputElement>("#azure-toggle")!;
const formApiKeyField = document.querySelector<HTMLInputElement>("#api-key")!;
const formDeploymentOrModelField = document.querySelector<HTMLInputElement>("#deployment-or-model")!;
const formSessionInstructionsField =
  document.querySelector<HTMLTextAreaElement>("#session-instructions")!;
const formTemperatureField = document.querySelector<HTMLInputElement>("#temperature")!;
const formVoiceSelection = document.querySelector<HTMLInputElement>("#voice")!;

let latestInputSpeechBlock: Element;

enum InputState {
  Working,
  ReadyToStart,
  ReadyToStop,
}

function isAzureOpenAI(): boolean {
  return formAzureToggle.checked;
}

function guessIfIsAzureOpenAI() {
  const endpoint = (formEndpointField.value || "").trim();
  formAzureToggle.checked = endpoint.indexOf('azure') > -1;
}

function setFormInputState(state: InputState) {
  formEndpointField.disabled = state != InputState.ReadyToStart;
  formApiKeyField.disabled = state != InputState.ReadyToStart;
  formDeploymentOrModelField.disabled = state != InputState.ReadyToStart;
  formStartButton.disabled = state != InputState.ReadyToStart;
  formStopButton.disabled = state != InputState.ReadyToStop;
  formSessionInstructionsField.disabled = state != InputState.ReadyToStart;
  formAzureToggle.disabled = state != InputState.ReadyToStart;
}

// function getSystemMessage(): string {
//   return formSessionInstructionsField.value || "";
// }

function getTemperature(): number {
  return parseFloat(formTemperatureField.value);
}

function getVoice(): Voice {
  return formVoiceSelection.value as Voice;
}

function makeNewTextBlock(text: string = "") {
  let newElement = document.createElement("p");
  newElement.textContent = text;
  formReceivedTextContainer.appendChild(newElement);
}

function appendToTextBlock(text: string) {
  let textElements = formReceivedTextContainer.children;
  if (textElements.length == 0) {
    makeNewTextBlock();
  }
  textElements[textElements.length - 1].textContent += text;
}

formStartButton.addEventListener("click", async () => {
  setFormInputState(InputState.Working);

  const endpoint = formEndpointField.value.trim();
  const key = formApiKeyField.value.trim();
  const deploymentOrModel = formDeploymentOrModelField.value.trim();

  if (isAzureOpenAI() && !endpoint && !deploymentOrModel) {
    alert("Endpoint and Deployment are required for Azure OpenAI");
    return;
  }

  if (!isAzureOpenAI() && !deploymentOrModel) {
    alert("Model is required for OpenAI");
    return;
  }

  if (!key) {
    alert("API Key is required");
    return;
  }

  try {
    start_realtime(endpoint, key, deploymentOrModel);
  } catch (error) {
    console.log(error);
    setFormInputState(InputState.ReadyToStart);
  }
});

formStopButton.addEventListener("click", async () => {
  makeNewTextBlock("<< Session Ended >>");
  await realtimeStreaming.send(createConfigMessage(`Evaluate the interview that you took now for the fresher SDE role at Unstop, focusing on assessing technical and soft skills related to Angular, Laravel, Python, communication, and problem-solving abilities. Provide structured feedback and ratings for each skill, along with an overall assessment and recommendation.
  
  # Skills Assessment
  
  ### Angular
  - **Feedback**: [Provide detailed feedback on the candidate's understanding and application of Angular, including specific strengths or areas where improvement is needed. Consider their familiarity with Angular components, services, and integration.]
  - **Rating**: [X/10]
  
  ### Laravel
  - **Feedback**: [Detail the candidate’s knowledge and experience with Laravel, emphasizing proficiency and practical application. Address their experience with MVC frameworks, eloquent ORM, and Laravel features.]
  - **Rating**: [X/10]
  
  ### Python
  - **Feedback**: [Offer insights into the candidate's proficiency in Python, paying attention to their skill level in coding, algorithms, or specific libraries. Mention their ability to solve problems efficiently using Python.]
  - **Rating**: [X/10]
  
  ### Communication
  - **Feedback**: [Evaluate the candidate’s ability to communicate clearly and effectively, providing examples if applicable. Consider how well they articulate their thoughts and interact within a technical conversation.]
  - **Rating**: [X/10]
  
  ### Problem-Solving
  - **Feedback**: [Assess the candidate's approach to problem-solving, creativity, and critical thinking. Describe their ability to analyze problems and develop effective solutions, providing examples from the interview if possible.]
  - **Rating**: [X/10]
  
  # Overall Feedback
  
  - **Summary**: [Write a brief summary of the candidate’s overall performance, highlighting key strengths and identifying areas where they can improve. Consider the balance of technical and soft skills.]
  - **Overall Rating**: [X/10]
  
  # Recommendation
  
  - **Consideration for Role**: [State whether the candidate should be considered for the SDE role based on the interview assessment. Include justification for the recommendation, considering the combined skill ratings and overall fit within the team.]
  
  # Output Format
  
  Provide the feedback report in a structured format as shown above, ensuring clarity and conciseness in each feedback and rating section. Also only generate report if there is enough interactin between the candidate and the interviewer.`));
  
  console.log("Feedback config has been sent");
  setFormInputState(InputState.Working);
  resetAudio(false);
  feedbackready = true;
  realtimeStreaming.send(
    {
      "type":"conversation.item.create",
      "item":{
         "type":"message",
         "role":"user",
         "content":[
            {
               "type":"input_text",
               "text":"Could you please share me the detailed feedback and if I am eligible for the role or not. Also analysis on each and every question. Only give the feedback when there is enough interaction with the candidate."
            }
         ]
      }
   });
   realtimeStreaming.send({
    type: "response.create",
  });
  setFormInputState(InputState.ReadyToStart);
  setTimeout(() => {
    realtimeStreaming.close();
  }, 60000);
  });

formClearAllButton.addEventListener("click", async () => {
  formReceivedTextContainer.innerHTML = "";
});

formEndpointField.addEventListener('change', async () => {
  guessIfIsAzureOpenAI();
});
guessIfIsAzureOpenAI();