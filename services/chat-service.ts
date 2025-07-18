import { SnappyHTTPClient } from "@/lib/SnappyHTTPClient";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ChatResource, GetChatDetailsDto, Message, MessageAckEnum, MessageAttachement } from "@/lib/models";
import { Alert } from "react-native";
import { API_URL, PROJECT_ID } from '@/lib/constants';


function addOneHour(dateInput: string | Date): string {
  const date = new Date(dateInput);
  const datePlusOneHour = new Date(date.getTime() + 60 * 60 * 1000);
  return datePlusOneHour.toISOString();
}


export class ChatService {
  private static api = new SnappyHTTPClient(API_URL);


  public static async getRequesterId(): Promise<string> {
    const userId = await (async () => {
      const user = await AsyncStorage.getItem("user");
      return user ? JSON.parse(user).externalId : this.api.getUser()!.externalId!;
    })();

    return userId;
  }
  public static async getUserChat(): Promise<ChatResource[]> {
    try {
      const requesterId = await this.getRequesterId();
      console.log("Données envoyées au serveur :", requesterId, PROJECT_ID);

      const onlineChats = await this.api.getUserChats(requesterId, PROJECT_ID);

      console.log("Response serveur UserChats:", onlineChats);

      if (!onlineChats) {
        console.warn("Aucune donnée reçue du serveur.");
        return [];
      }

      // Tri par date décroissante (plus récent d'abord)
      const sortedOnlineChats = onlineChats.sort((a, b) =>
        new Date(b.lastMessage?.createdAt ?? 0).getTime() - new Date(a.lastMessage?.createdAt ?? 0).getTime()
      );

      await AsyncStorage.setItem("userChats", JSON.stringify(sortedOnlineChats));
      return sortedOnlineChats;

    } catch (error) {
      const chats = await AsyncStorage.getItem("userChats");
      console.log("response userChat : ", chats);

      if (chats) {
        const parsedChats: ChatResource[] = JSON.parse(chats);
        return parsedChats.sort((a, b) =>
          new Date(b.lastMessage?.createdAt ?? 0).getTime() - new Date(a.lastMessage?.createdAt ?? 0).getTime()
        );
      }

      return [];
    }
  }
  public static async getChatDetails(name: string): Promise<Message[]> {
    const users = await this.api.filterUserByDisplayName({ displayName: name, projectId: PROJECT_ID });
    const interlocutorId = users[0]?.externalId;

    if (!interlocutorId) {
      console.warn("Interlocuteur introuvable.");
      return [];
    }

    const requesterId = await this.getRequesterId();

    // Récupération du cache
    const chatDetails = await AsyncStorage.getItem(interlocutorId);
    if (chatDetails) {
      const parsedMessages: Message[] = JSON.parse(chatDetails);

      // Filtrer les messages pertinents
      const filtered = parsedMessages.filter(
        (message) => message.sender === requesterId || message.receiver === requesterId
      );

      // Ici, les dates sont déjà modifiées dans le cache, on peut retourner directement
      return filtered.sort(
        (a, b) => new Date(a!.createdAt!).getTime() - new Date(b!.createdAt!).getTime()
      );
    }

    // Pas de cache, requête serveur
    const chatDetailsDto: GetChatDetailsDto = {
      user: requesterId.toString(),
      interlocutor: interlocutorId,
      projectId: PROJECT_ID,
    };

    try {
      const onlineChatDetails = await this.api.getChatDetails(chatDetailsDto);
      if (!onlineChatDetails) {
        console.warn("Aucune donnée reçue du serveur.");
        return [];
      }

      const allMessages: Message[] = onlineChatDetails.messages ?? [];

      // Ajoute 1 heure à createdAt avant stockage
      const messagesWithAdjustedDate = allMessages.map((message) => ({
        ...message,
        createdAt: addOneHour(message!.createdAt!),
      }));

      // Stocke les messages avec date modifiée
      await AsyncStorage.setItem(interlocutorId, JSON.stringify(messagesWithAdjustedDate));

      // Filtrer et trier avant retour
      const filteredSortedMessages = messagesWithAdjustedDate
        .filter((message) => message.sender === requesterId || message.receiver === requesterId)
        .sort((a, b) => new Date(a!.createdAt!).getTime() - new Date(b!.createdAt!).getTime());

      return filteredSortedMessages.map(message => ({
        ...message,
        createdAt: new Date(message.createdAt),
      }));

    } catch (error) {
      console.error("Erreur getChatDetails:", error);
      return [];
    }
  }

  public static async receiveMessage(senderName: string, message: Message, messages: any, setMessages: any) {
    console.log("message reçu", message);

    const newMessage = {
      id: message.id,
      body: message.body,
      sender: message.sender,
      receiver: message.receiver,
      ack: MessageAckEnum.RECEIVED,
      createdAt: new Date()
    };

    try {
      // Récupérer les conversations existantes
      const chatDetails = await this.getChatDetails(senderName);

      // Ajouter le nouveau message à la conversation
      if (chatDetails) {
        chatDetails.push(newMessage);
        // Sauvegarder la liste des messages mise à jour dans AsyncStorage
        await AsyncStorage.setItem(message!.sender!, JSON.stringify(chatDetails));
        console.log("liste message local : ", await AsyncStorage.getItem(message!.sender!));
      } else {
        // Si c'est la première conversation avec cet utilisateur
        const requesterId = await this.getRequesterId();
        const onlineChats = await this.api.getUserChats(requesterId, PROJECT_ID);

        // Sauvegarder les conversations en ligne
        await AsyncStorage.setItem("userChats", JSON.stringify(onlineChats));
        await AsyncStorage.setItem(message!.sender!, JSON.stringify([newMessage]));
        console.log("liste message online: ", await AsyncStorage.getItem(message!.sender!));
      }

      // Mettre à jour l'état avec les nouveaux messages
      const updatedChatDetails = await this.getChatDetails(senderName); // récupérer les détails après mise à jour
      setMessages(updatedChatDetails);

    } catch (err) {
      console.error("Erreur lors de la mise à jour du chat", err);
      Alert.alert("Erreur d'envoi", "Erreur lors de la mise à jour du chat." + err);
    }
  }


  public static async sendMessage(body: string, receiverName: string, messages: any, setMessages: any) {

    console.log("envoie du message", body)

    //Recherche de l'interloccutor par son nom
    const users = await this.api.filterUserByDisplayName({
      "displayName": receiverName,
      "projectId": PROJECT_ID
    });
    const interlocutorId = users[0]!.externalId!;

    //mise à jour du messages dasns chatItem
    try {
      setMessages([...messages,
      {
        id: Date.now().toString() + Math.random().toString(),
        body: body,
        sender: (await this.getRequesterId()).toString(),
        receiver: interlocutorId,
        ack: "SENT",
        createdAt: Date.now(),
      }
      ]);
    } catch (err) {
      console.error("erreur lors de la mise à jour du chat", err);
      Alert.alert("Erreur d'envoi", "erreur lors de la mise à jour du chat." + err);
    }


    //logique d'envoi de message
    try {
      const res = await this.api.sendMessage({
        body,
        projectId: PROJECT_ID,
        receiverId: interlocutorId,
        senderId: (await this.getRequesterId()).toString(),

      });

      console.log("response send message ", res);

      if (res) {

        //recupere les conversations
        const chatDetails = await this.getChatDetails(receiverName);

        const resUpdated = Array.isArray(res) ? res.map((message) => ({
          ...message,
          createdAt: addOneHour(message!.createdAt!),
        })) : [{
          ...res,
          createdAt: addOneHour(res!.createdAt!),
        }];
        //si c'est non vide
        if (chatDetails) {
          if (Array.isArray(resUpdated)) {
            chatDetails.push(...resUpdated);
          } else {
            chatDetails.push(resUpdated);
          }
          await AsyncStorage.setItem(interlocutorId, JSON.stringify(chatDetails));
          console.log("liste message local : ", await AsyncStorage.getItem(interlocutorId));
        } else {
          //si c'est la premiere conversation
          //recupere la liste des avec qui il a deja echangé
          const requesterId = await this.getRequesterId();
          const onlineChats = await this.api.getUserChats(requesterId, PROJECT_ID);
          console.log("getUserChats Response: ", onlineChats)

          //ajoute l'interloccuteur actuele

          await AsyncStorage.setItem("userChats", JSON.stringify(onlineChats));
          await AsyncStorage.setItem(interlocutorId, JSON.stringify(resUpdated));
          console.log("liste message online: ", await AsyncStorage.getItem(interlocutorId));
        }
      }

      return res;
    } catch (err) {
      console.log(err);
      Alert.alert("Erreur d'envoi", "Le message n'a pas pu être envoyé. Veuillez réessayer plus tard." + err);
      return null;
    }
  }


  public static async sendMessageWithAttachment(
    file: { uri: string, filename?: string, mimeType?: string, filesize?: number, path?: string },
    receiverName: string,
    messages: any,
    setMessages: any
  ) {

    console.log("message", file)
    // 1. Trouver l'interlocuteur
    const users = await this.api.filterUserByDisplayName({
      displayName: receiverName,
      projectId: PROJECT_ID
    });
    const interlocutorId = users[0]?.externalId;
    if (!interlocutorId) throw new Error('Interlocuteur introuvable');

    // 2. Uploader le fichier

    // 3. Créer le MessageAttachement
    const attachement: MessageAttachement = {
      filename: file.filename,
      mimetype: file.mimeType,
      filesize: file.filesize,
      path: file.path,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // 4. Envoyer le message via sendMessage
    const messageDto = {
      body: '',
      projectId: PROJECT_ID,
      receiverId: interlocutorId,
      senderId: (await this.getRequesterId()).toString(),
      messageAttachements: [attachement],
    };

    // Ajoute dans l'UI
    setMessages([
      ...messages,
      {
        id: Date.now().toString() + Math.random().toString(),
        body: 'file : ' + file.filename,
        sender: (await this.getRequesterId()).toString(),
        receiver: interlocutorId,
        ack: "SENT",
        createdAt: Date.now(),
        messageAttachements: [attachement],
      }
    ]);

    // Appel API
    try {
      const res = await this.api.sendMessage(messageDto);
      // Gère la réponse comme dans sendMessage classique
      if (res) {

        //recupere les conversations
        const chatDetails = await this.getChatDetails(receiverName);

        const resUpdated = Array.isArray(res) ? res.map((message) => ({
          ...message,
          createdAt: addOneHour(message!.createdAt!),
        })) : [{
          ...res,
          createdAt: addOneHour(res!.createdAt!),
        }];
        //si c'est non vide
        if (chatDetails) {
          if (Array.isArray(resUpdated)) {
            chatDetails.push(...resUpdated);
          } else {
            chatDetails.push(resUpdated);
          }
          await AsyncStorage.setItem(interlocutorId, JSON.stringify(chatDetails));
          console.log("liste message local : ", await AsyncStorage.getItem(interlocutorId));
        } else {
          //si c'est la premiere conversation
          //recupere la liste des avec qui il a deja echangé
          const requesterId = await this.getRequesterId();
          const onlineChats = await this.api.getUserChats(requesterId, PROJECT_ID);
          console.log("getUserChats Response: ", onlineChats)

          //ajoute l'interloccuteur actuele

          await AsyncStorage.setItem("userChats", JSON.stringify(onlineChats));
          await AsyncStorage.setItem(interlocutorId, JSON.stringify(resUpdated));
          console.log("liste message online: ", await AsyncStorage.getItem(interlocutorId));
        }
      }

      return res;
    } catch (err) {
      console.log(err);
      Alert.alert("Erreur d'envoi", "Le message n'a pas pu être envoyé. Veuillez réessayer plus tard." + err);
      return null;
    }
  }
}