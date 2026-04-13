import sqlite3
import os
import glob




#=====================================================================================================================================================================================================================================================================

class CreatePlaylists():

    def __init__(self):

        self.conn = sqlite3.connect('j:/m.db')
        self.cursor = self.conn.cursor()
        self.conn.row_factory = sqlite3.Row

        # GET Orign Database UUID
        self.cursor.execute("select uuid from Information")
        row = self.cursor.fetchone()
        self.originDatabaseUuid = row[0]

        # Get or Create default albumArtId
        self.cursor.execute("select id from AlbumArt")
        rows = self.cursor.fetchall()
        if len(rows) == 0:
            self.cursor.execute("insert into AlbumArt (hash, albumArt) values (NULL, NULL)")
            self.albumArtId = self.cursor.lastrowid
            print("albumArtId created " + str(self.albumArtId))
        else:
            self.cursor.execute("select id from AlbumArt")
            self.albumArtId = self.cursor.fetchone()[0]
            print("albumArtId " + str(self.albumArtId))


        self.tracksAdded = []
        self.foldersChanged = []

        
        # Parse Directories recursively
        self.DoDirectory('J:/MIX/', 'MAIN', -1)

        self.cursor.close()
        self.conn.commit()        
        self.conn.close()
        

        #RESULT
        print('')
        print("=======================================")
        print("Folders changed : " + str(len(self.foldersChanged)))
        print("=======================================")
        for i in range(len(self.foldersChanged)):
            print (self.foldersChanged[i])
        print('')
        print("=======================================")
        print("Tracks added : " + str(len(self.tracksAdded)))
        print("=======================================")

        with open('J:/tracksAdded.txt', 'w', encoding='utf-8') as f:
            for line in self.tracksAdded:
                f.write(line + '\n')
     
            





    # Completely clear the database !!!
    def ClearDatabase():
        self.cursor.execute("delete from Playlist")
        self.cursor.execute("delete from Track")
        self.cursor.execute("delete from PlaylistEntity")










    def GetOrCreatePlaylist(self, playlistName, parentPlaylistId):

        print('Get or Create playlist ' + playlistName + ' with parent ' + str(parentPlaylistId))
        
        playlistId = self.GetPlaylist(playlistName, parentPlaylistId)
        print('playlist exists ? ' + str(playlistId))
        if(playlistId is None):
            playlistId = self.CreatePlaylist(playlistName, parentPlaylistId)

        return playlistId


    def GetPlaylist(self, playlistName, parentPlaylistId):

        print('Get playlist ' + playlistName + ' with parent ' + str(parentPlaylistId))

        if parentPlaylistId == -1:
            self.cursor.execute("select id from Playlist where title=? and parentListId=0", (playlistName,))
        else:
            self.cursor.execute("select id from Playlist where title=? and parentListId=?", (playlistName, str(parentPlaylistId), ))

        rows = self.cursor.fetchall()
        if len(rows) == 0:
            print('Playlist does not exist, return null')
            return None
        else:
            return rows[0][0]


    def CreatePlaylist(self, playlistName, parentPlaylistId):

        print('Create playlist ' + playlistName + ' with parent ' + str(parentPlaylistId))

        if parentPlaylistId == -1:
            self.cursor.execute("insert into Playlist (title, parentListId, isPersisted) VALUES (?, 0, 1)", (playlistName,))
        else:
            self.cursor.execute("insert into Playlist (title, parentListId, isPersisted) VALUES (?, ?, '1')", (playlistName, str(parentPlaylistId), ))

        return self.cursor.lastrowid









    def DoesTrackExist(self, path, filename):

        self.cursor.execute("select id from Track where path=? and filename=?", (path, filename, ))

        rows = self.cursor.fetchall()
        if len(rows) == 0:
            return False
        else:
            return True


    def CreateTrack(self, path, filename):

        trackReq = "insert into Track (title, path, filename, fileType, albumArtId, isAvailable) VALUES (?, ?, ?, 'mp3', '1', '1');"
        self.cursor.execute(trackReq, ('titletmp', path, filename,))
        lastTrackIdId = self.cursor.lastrowid

        self.tracksAdded.append(path + " " + filename)

        return lastTrackIdId


    def CreatePlaylistEntity(self, playlistId, trackId):
        self.cursor.execute("insert into PlaylistEntity (listId, trackId, membershipReference, nextEntityId, databaseUuid) VALUES (?, ?, '0', '0', ?);", (str(playlistId), str(trackId), self.originDatabaseUuid, ))







    def DoDirectory(self, baseDir, dir, parentPlaylistId):

        currDir = baseDir + dir + "/"

        print ('----------------------------------- ' + currDir)

        # Move to Directory
        os.chdir(currDir)
        # Get files & subdirectories
        items = os.listdir()
        files = []
        folders = []
        for i in range(len(items)):
            if os.path.isdir(items[i]):
                folders.append(items[i])

            elif os.path.isfile(items[i]):
                if '.mp3' in items[i]:
                    filePath = items[i]
                    files.append(filePath)

        # get or create playlist, retrieve ID
        lastPlaylistId = self.GetOrCreatePlaylist(dir, parentPlaylistId)

        folderChanged = False

        # add tracks to playlist
        for file in files:
            
            trackPath = currDir.replace('J:/MIX/', '../MIX/') + file
            trackFileName = file

            if not self.DoesTrackExist(trackPath, trackFileName):
                print('New Track added : ' + trackFileName)
                lastTrackIdId = self.CreateTrack(trackPath, trackFileName)
                self.CreatePlaylistEntity(lastPlaylistId, lastTrackIdId)
                folderChanged = True
            else:
                print('track exists, is ignored : ' + trackFileName)

        if(folderChanged):
            self.foldersChanged.append(currDir)


        # go in sub folders
        for subfolder in folders:
            self.DoDirectory(currDir, subfolder, lastPlaylistId)

            



#=====================================================================================================================================================================================================================================================================





test = CreatePlaylists()


